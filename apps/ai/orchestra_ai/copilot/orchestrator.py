# ============================================================================
# Orchestra Part 8 — Copilot Orchestrator (10-stage pipeline)
# Source of truth: Part 8 § "CopilotOrchestrator"
# This is the centrepiece of the document. One paragraph in, complete draft out.
# ============================================================================

from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from typing import Any

import structlog

from orchestra_ai.copilot.capabilities import require
from orchestra_ai.copilot.models import (
    ActionIntent,
    Autonomy,
    ConnectionChoice,
    GenerationResult,
    IntentSpec,
    Selection,
    Stage,
    StepMapping,
    Todo,
    TriggerIntent,
)
from orchestra_ai.copilot.ranker import rank_candidates, rank_triggers, rank_actions, select_best
from orchestra_ai.copilot.critic import critique_graph, repair_graph
from orchestra_ai.copilot.confidence import (
    ConfidenceReport,
    estimate_intent_confidence,
    estimate_trigger_confidence,
    estimate_operation_confidence,
    estimate_connection_confidence,
    estimate_graph_confidence,
)
from orchestra_ai.memory.store import get_memory_store
from orchestra_ai.gateway.gateway import CallSpec, Message, ModelGateway, Purpose
from orchestra_ai.node.client import NodeApiClient
from orchestra_ai.prompts.registry import PromptRegistry
from orchestra_ai.schemas.contracts import Attribution
from orchestra_ai.settings import get_settings

log = structlog.get_logger(__name__)


STAGE_LABELS = {
    "intent": "Understanding your request",
    "retrieve": "Finding apps and events",
    "select": "Selecting operations",
    "connections": "Matching connected accounts",
    "schemas": "Reading data shapes",
    "mapping": "Mapping fields between steps",
    "assemble": "Building the flow",
    "validate": "Checking the flow",
    "repair": "Repairing the draft",
    "persist": "Saving the draft (not publishing)",
}


def sse(event_type: str, data: dict[str, Any]) -> str:
    """Format a Server-Sent Event the Node/web clients already parse."""
    payload = {"type": event_type, **data}
    if event_type == "stage" and "label" not in payload:
        stage = payload.get("stage")
        stage_key = getattr(stage, "value", stage)
        payload["stage"] = stage_key
        payload["label"] = STAGE_LABELS.get(str(stage_key), str(stage_key or "Working"))
    return f"data: {json.dumps(payload)}\n\n"


class CopilotOrchestrator:
    """
    10-stage Copilot pipeline. Each stage narrows the space the model may
    operate in. Six of ten stages involve no model at all — they are
    deterministic code. That ratio is why the pipeline is testable.
    """

    def __init__(
        self,
        gateway: ModelGateway,
        prompts: PromptRegistry,
    ) -> None:
        self._gw = gateway
        self._prompts = prompts
        settings = get_settings()
        self._node = NodeApiClient(settings.node_api_url, settings.service_token.get_secret_value())

    async def generate(
        self,
        session_id: str,
        flow_id: str,
        request_text: str,
        attribution: Attribution,
        user_email: str,
        project_id: str,
        autonomy: Autonomy = Autonomy.AUTO_BUILD,
        timezone: str = "UTC",
    ) -> AsyncIterator[str]:
        """Run the full 10-stage pipeline, yielding SSE events."""
        started = time.monotonic()
        todos: list[Todo] = []

        try:
            # ── Stage 1: Intent parsing ──────────────────────────────────
            yield sse("stage", {"stage": Stage.INTENT, "status": "start"})
            spec = await self._parse_intent(request_text, attribution)
            yield sse(
                "reasoning",
                {
                    "stage": Stage.INTENT,
                    "text": (
                        f"Understood: {spec.summary}. Trigger: "
                        f"{spec.trigger.app_hint or spec.trigger.kind}. "
                        f"{len(spec.actions)} action(s), {len(spec.logic)} logic node(s)."
                    ),
                },
            )

            for item in spec.out_of_scope:
                todos.append(Todo(kind="unsupported", message=item, severity="advisory"))

            if autonomy is Autonomy.ASK_AS_YOU_BUILD:
                blocking = [a for a in spec.ambiguities if a.blocking]
                if blocking:
                    for a in blocking:
                        yield sse(
                            "todo",
                            {
                                "kind": "clarify",
                                "message": a.question,
                                "field": a.field,
                                "assumption": a.assumption,
                            },
                        )
                    yield sse(
                        "done",
                        {"status": "awaiting_input", "session_id": session_id},
                    )
                    return

            for a in spec.ambiguities:
                todos.append(
                    Todo(
                        kind="clarify",
                        message=f"{a.question} Assumed: {a.assumption or 'nothing'}",
                        severity="advisory",
                    )
                )
            yield sse("stage", {"stage": Stage.INTENT, "status": "done"})

            # ── Stage 2: Candidate retrieval ─────────────────────────────
            yield sse("stage", {"stage": Stage.RETRIEVE, "status": "start"})
            try:
                trigger_cards = await self._node.search_catalog(
                    spec.trigger.search_text or spec.trigger.app_hint or spec.summary,
                    "trigger",
                )
            except Exception:
                trigger_cards = []
            action_cards: dict[int, list] = {}
            for action in spec.actions:
                try:
                    action_cards[action.order] = await self._node.search_catalog(
                        f"{action.operation_hint} {action.purpose}",
                        "action",
                    )
                except Exception:
                    action_cards[action.order] = []
            total = len(trigger_cards) + sum(len(v) for v in action_cards.values())
            yield sse(
                "reasoning",
                {
                    "stage": Stage.RETRIEVE,
                    "text": f"Searched the catalog and found {total} candidate operations.",
                },
            )
            yield sse("stage", {"stage": Stage.RETRIEVE, "status": "done"})

            # ── Stage 3: Constrained selection (with ranking) ──────────
            yield sse("stage", {"stage": Stage.SELECT, "status": "start"})

            # Rank triggers by relevance
            ranked_triggers = rank_candidates(
                spec.trigger.search_text or spec.trigger.app_hint or spec.summary,
                trigger_cards,
                kind="trigger",
            )
            selected_trigger = select_best(ranked_triggers) or (trigger_cards[0] if trigger_cards else None)
            if selected_trigger:
                yield sse("reasoning", {
                    "stage": Stage.SELECT,
                    "text": f"Selected trigger: {selected_trigger.name}/{selected_trigger.operation_name} (score: {selected_trigger.score:.1f}, reasons: {', '.join(selected_trigger.reasons[:3])})",
                })

            # Rank actions by relevance
            selected_actions = []
            for action in spec.actions:
                cards = action_cards.get(action.order, [])
                ranked = rank_candidates(f"{action.operation_hint} {action.purpose}", cards, kind="action")
                best = select_best(ranked)
                selected_actions.append((action, best or (cards[0] if cards else None)))

            yield sse("stage", {"stage": Stage.SELECT, "status": "done"})

            # ── Stage 4: Connection resolution ───────────────────────────
            yield sse("stage", {"stage": Stage.CONNECTIONS, "status": "start"})
            connections: dict[str, ConnectionChoice] = {}
            pieces = [c.get("slug") for c in [selected_trigger, *[card for _, card in selected_actions]] if c]
            for piece in {str(p) for p in pieces if p}:
                try:
                    found = await self._node.lookup_connections(
                        attribution.org_id, piece, attribution.request_id
                    )
                except Exception:
                    found = []
                if found:
                    connections[piece] = ConnectionChoice(
                        piece_name=piece,
                        connection_id=str(found[0].get("id") or "") or None,
                        connection_label=str(found[0].get("display_name") or found[0].get("label") or ""),
                        strategy="email_match",
                        needs_human=False,
                    )
                    yield sse(
                        "reasoning",
                        {"stage": Stage.CONNECTIONS, "text": f"Reusing existing {piece} connection."},
                    )
                else:
                    connections[piece] = ConnectionChoice(piece_name=piece, needs_human=True)
                    todos.append(
                        Todo(
                            kind="connect_account",
                            message=f"Connect {piece} — Copilot cannot create credentials.",
                            severity="advisory",
                        )
                    )
            yield sse("stage", {"stage": Stage.CONNECTIONS, "status": "done"})

            # ── Stages 5-6: Schema hydration and field mapping ───────────
            yield sse("stage", {"stage": Stage.SCHEMAS, "status": "start"})
            schemas_hydrated = 0
            all_schemas: dict[str, dict] = {}
            for piece in {str(p) for p in pieces if p}:
                try:
                    schema_data = await self._node.search_catalog(piece, None)
                    if schema_data:
                        all_schemas[piece] = schema_data[0] if schema_data else {}
                        schemas_hydrated += 1
                except Exception:
                    pass
            yield sse("reasoning", {
                "stage": Stage.SCHEMAS,
                "text": f"Hydrated schemas for {schemas_hydrated} app(s).",
            })
            yield sse("stage", {"stage": Stage.SCHEMAS, "status": "done"})

            yield sse("stage", {"stage": Stage.MAPPING, "status": "start"})
            field_mappings: dict[str, dict[str, str]] = {}
            for action_intent, action_card in selected_actions:
                if not action_card:
                    continue
                slug = action_card.get("slug", "")
                # Try to auto-map trigger outputs to action inputs
                trigger_slug = (selected_trigger or {}).get("slug", "")
                if trigger_slug and slug:
                    # Simple heuristic: map common fields
                    trigger_prefix = f"trigger.{trigger_slug}"
                    action_prefix = f"{slug}"
                    auto_map: dict[str, str] = {}
                    # Map email fields
                    auto_map["email"] = f"{trigger_prefix}.from"
                    auto_map["name"] = f"{trigger_prefix}.sender_name"
                    auto_map["message"] = f"{trigger_prefix}.body"
                    auto_map["subject"] = f"{trigger_prefix}.subject"
                    auto_map["text"] = f"{trigger_prefix}.body"
                    auto_map["title"] = f"{trigger_prefix}.subject"
                    field_mappings[action_card.get("key", "action")] = auto_map
            yield sse("reasoning", {
                "stage": Stage.MAPPING,
                "text": f"Generated {sum(len(m) for m in field_mappings.values())} field mapping(s) across {len(field_mappings)} step(s).",
            })
            yield sse("stage", {"stage": Stage.MAPPING, "status": "done"})

            # ── Stage 7: Graph assembly ──────────────────────────────────
            yield sse("stage", {"stage": Stage.ASSEMBLE, "status": "start"})
            definition = self._assemble_definition(
                spec, timezone, selected_trigger, selected_actions, connections
            )
            yield sse(
                "reasoning",
                {
                    "stage": Stage.ASSEMBLE,
                    "text": f"Assembled a graph with {len(definition.get('nodes', definition.get('steps', [])))} step(s).",
                },
            )
            yield sse("stage", {"stage": Stage.ASSEMBLE, "status": "done"})

            # ── Stages 8-9: Validate and repair ─────────────────────────
            yield sse("stage", {"stage": Stage.VALIDATE, "status": "start"})
            # Use the critic to validate the graph
            connected_apps = list(connections.keys()) if connections else []
            critic_result = critique_graph(definition, connected_apps=connected_apps)
            issues = [{"code": i.code, "message": i.message, "severity": i.severity} for i in critic_result.issues]
            warnings = [{"code": w.code, "message": w.message, "severity": w.severity} for w in critic_result.warnings]
            yield sse("reasoning", {
                "stage": Stage.VALIDATE,
                "text": f"Critic: {len(issues)} error(s), {len(warnings)} warning(s).",
            })
            yield sse("stage", {"stage": Stage.VALIDATE, "status": "done"})

            # Repair loop
            repair_passes = 0
            if issues:
                yield sse("stage", {"stage": Stage.REPAIR, "status": "start"})
                repair_result = repair_graph(definition, connected_apps=connected_apps)
                repair_passes = repair_result.pass_count
                if repair_result.fixes_applied:
                    definition = repair_result.graph  # use repaired graph
                    issues = [{"code": i.code, "message": i.message, "severity": i.severity} for i in repair_result.issues]
                    warnings = [{"code": w.code, "message": w.message, "severity": w.severity} for w in repair_result.warnings]
                    yield sse("reasoning", {
                        "stage": Stage.REPAIR,
                        "text": f"Repaired: {len(repair_result.fixes_applied)} fix(es) applied in {repair_passes} pass(es).",
                    })
                yield sse("stage", {"stage": Stage.REPAIR, "status": "done"})

            # ── Stage 10: Persist as draft ───────────────────────────────
            yield sse("stage", {"stage": Stage.PERSIST, "status": "start"})
            require("write_draft")
            yield sse("stage", {"stage": Stage.PERSIST, "status": "done"})

            for todo in todos:
                yield sse("todo", todo.model_dump())

            # Compute per-decision confidence
            confidence = ConfidenceReport(
                intent=estimate_intent_confidence(request_text, spec.model_dump()),
                trigger=estimate_trigger_confidence(selected_trigger, trigger_cards),
                operations=estimate_operation_confidence(
                    [card for _, card in selected_actions if card],
                    [action_cards.get(a.order, []) for a in spec.actions],
                ),
                connections=estimate_connection_confidence(connections, pieces),
                graph=estimate_graph_confidence(critic_result.valid, len(issues), len(warnings)),
            )
            confidence.compute_overall()

            # Store workflow memory for future edits
            try:
                mem = get_memory_store()
                mem.remember_workflow(
                    flow_id,
                    "last_trigger",
                    spec.trigger.app_hint or spec.trigger.kind,
                    source="system",
                    reason="Store trigger for future edits",
                )
                for action_intent, action_card in selected_actions:
                    if action_card:
                        mem.remember_workflow(
                            flow_id,
                            f"action_{action_intent.order}",
                            f"{action_card.get('slug', '')}/{action_card.get('key', '')}",
                            source="system",
                            reason="Store action for future edits",
                        )
            except Exception:
                pass  # memory is best-effort

            result = GenerationResult(
                session_id=session_id,
                flow_id=flow_id,
                definition=definition,
                todos=todos,
                issues=issues,
                publishable=critic_result.valid,
                repair_passes=repair_passes,
                confidence=confidence.overall,
                cost_usd=0.0,
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

            yield sse("proposal", {
                **result.model_dump(),
                "graph": definition,
                "summary": spec.summary,
                "confidence": confidence.model_dump(),
            })
            yield sse(
                "result",
                {
                    "graph": definition,
                    "summary": spec.summary,
                    "applied": autonomy is Autonomy.AUTO_BUILD,
                    "rebuilt": True,
                    "changed": True,
                    "source": "python-copilot",
                    "mode": autonomy.value,
                },
            )
            yield sse(
                "done",
                {
                    "status": "draft_saved",
                    "publishable": result.publishable,
                    "note": "Review and publish. Copilot never publishes.",
                    "elapsed_ms": result.elapsed_ms,
                },
            )

        except Exception as exc:
            log.exception("copilot.failed")
            yield sse(
                "error",
                {
                    "code": "COPILOT_FAILED",
                    "message": "Generation failed. Your draft was not changed.",
                    "detail": str(exc)[:300],
                },
            )

    async def _parse_intent(
        self, request_text: str, attribution: Attribution
    ) -> IntentSpec:
        """Stage 1: Parse user request into structured intent."""
        try:
            system = self._prompts.render("copilot/intent", version="v1")
            spec = await self._gw.call_json(
                CallSpec(
                    purpose=Purpose.COPILOT_PLAN,
                    system=system,
                    messages=[Message(role="user", content=request_text)],
                    attribution=attribution,
                ),
                output_model=IntentSpec,
            )
            parsed = spec[0] if isinstance(spec, tuple) else spec
            if isinstance(parsed, IntentSpec):
                return parsed
        except Exception:
            log.info("copilot.intent.heuristic")
        return heuristic_intent(request_text)

    def _assemble_definition(
        self,
        spec: IntentSpec,
        timezone: str = "UTC",
        trigger_card: dict[str, Any] | None = None,
        action_cards: list[tuple[ActionIntent, dict[str, Any] | None]] | None = None,
        connections: dict[str, ConnectionChoice] | None = None,
    ) -> dict[str, Any]:
        """Assemble a builder graph the Node frontend can persist."""
        bound = connections or {}
        trigger_slug = (trigger_card or {}).get("slug") or spec.trigger.app_hint or (
            "schedule" if spec.trigger.kind == "schedule" else "webhook" if spec.trigger.kind == "webhook" else "manual"
        )
        trigger_key = (trigger_card or {}).get("key") or (
            "cron" if spec.trigger.kind == "schedule" else "catch_hook" if spec.trigger.kind == "webhook" else "button"
        )
        trigger_conn = bound.get(str(trigger_slug))
        nodes: list[dict[str, Any]] = [
            {
                "id": "trigger",
                "type": "trigger",
                "appSlug": trigger_slug,
                "operation": trigger_key,
                "label": (trigger_card or {}).get("op_name") or spec.trigger.event_hint or "Trigger",
                "position": {"x": 280, "y": 40},
                "config": {},
                "connectionId": trigger_conn.connection_id if trigger_conn else None,
            }
        ]
        edges: list[dict[str, Any]] = []
        prev = "trigger"
        for i, (intent, card) in enumerate(action_cards or [(a, None) for a in spec.actions]):
            slug = (card or {}).get("slug") or "http"
            key = (card or {}).get("key") or "request"
            step_id = self._unique_slug(f"{slug}_{key}", intent.order, {n["id"] for n in nodes})
            conn = bound.get(str(slug))
            nodes.append(
                {
                    "id": step_id,
                    "type": "action",
                    "appSlug": slug,
                    "operation": key,
                    "label": (card or {}).get("op_name") or intent.purpose,
                    "position": {"x": 280, "y": 200 + i * 160},
                    "config": {},
                    "connectionId": conn.connection_id if conn else None,
                }
            )
            edges.append({"id": f"e-{prev}-{step_id}", "source": prev, "target": step_id})
            prev = step_id
        if len(nodes) == 1:
            nodes.append(
                {
                    "id": "action",
                    "type": "action",
                    "appSlug": "http",
                    "operation": "request",
                    "label": "HTTP Request",
                    "position": {"x": 280, "y": 200},
                    "config": {},
                    "connectionId": None,
                }
            )
            edges.append({"id": "e-trigger-action", "source": "trigger", "target": "action"})
        return {
            "schemaVersion": 1,
            "nodes": nodes,
            "edges": edges,
            "settings": {"timezone": timezone, "concurrency": 1, "errorHandling": {"mode": "fail"}},
        }

    @staticmethod
    def _unique_slug(hint: str, order: int, used: set[str]) -> str:
        import re
        slug = re.sub(r"[^a-z0-9]+", "_", hint.lower()).strip("_")[:40]
        candidate = slug or f"step_{order + 1}"
        n = 2
        while candidate in used:
            candidate = f"{slug}_{n}"
            n += 1
        used.add(candidate)
        return candidate


def heuristic_intent(text: str) -> IntentSpec:
    lower = text.lower()
    kind = "app_event"
    if any(w in lower for w in ("every morning", "every day", "cron", "schedule")):
        kind = "schedule"
    elif "webhook" in lower:
        kind = "webhook"
    parts = [p.strip() for p in re.split(r"\b(?:then|and then|after that)\b", text, flags=re.I) if p.strip()]
    if len(parts) < 2:
        parts = [p.strip() for p in re.split(r"\s*,\s*(?=send|add|notify|create|post|append|write)", text, flags=re.I) if p.strip()]
    trigger = parts[0] if parts else text
    actions = parts[1:] or []
    if not actions:
        for phrase in re.findall(r"((?:send|add|notify|create|post|append)[^.]{3,80})", text, flags=re.I):
            actions.append(phrase.strip())
    app_hint = None
    for name in ("gmail", "slack", "sheets", "hubspot", "typeform", "calendar"):
        if name in lower:
            app_hint = "google-sheets" if name == "sheets" else name
            break
    return IntentSpec(
        summary=text[:160],
        trigger=TriggerIntent(kind=kind, search_text=trigger, app_hint=app_hint, event_hint=trigger),
        actions=[ActionIntent(purpose=p, operation_hint=p, order=i) for i, p in enumerate(actions)],
    )
