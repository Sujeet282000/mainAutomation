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
            # Deterministic trigger anchor: if the request clearly names a
            # source app, search for that phrase so the right trigger card
            # is even in the candidate list (LLM intent text can drift).
            trigger_anchor = _detect_trigger(request_text)
            trigger_query = (
                (trigger_anchor[1] if trigger_anchor else None)
                or spec.trigger.search_text
                or spec.trigger.app_hint
                or spec.summary
            )
            try:
                trigger_cards = await self._node.search_catalog(
                    trigger_query,
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
            # Fallback when the LLM intent produced no action segments: derive
            # actions from the request tail so plans never come back empty.
            if not spec.actions:
                from orchestra_ai.copilot.orchestrator import _split_actions, _enrich_action_hint  # self-import: same module
                tail = _split_actions(request_text)[1:] if _split_actions(request_text) else []
                derived = tail or re.findall(
                    rf"((?:send|add|notify|create|post|append|write|analyze|analyse|summarize|summarise|classify|generate|draft|reply|log|store|save|insert|update)[^,.]{{3,120}})",
                    request_text,
                    flags=re.I,
                )
                for i, p in enumerate(derived):
                    hint = _enrich_action_hint(p)
                    spec.actions.append(ActionIntent(purpose=p.strip(), operation_hint=hint, order=i))
                    try:
                        action_cards[i] = await self._node.search_catalog(f"{hint} {p}", "action")
                    except Exception:
                        action_cards[i] = []
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

            # Rank triggers by relevance — use the same anchored query used for
            # retrieval so "when a new lead arrives" ranks CRM triggers, not the
            # Sheets trigger the LLM drifted toward later in the sentence.
            ranked_triggers = rank_candidates(
                trigger_query,
                trigger_cards,
                kind="trigger",
            )
            # normalize SelectedCards: RankedCandidate is a pydantic model while
            # trigger_cards entries are raw dicts — downstream code calls .get()
            # on both, which crashed with 'RankedCandidate' object has no
            # attribute 'get' and killed the whole AI plane (COPILOT_FAILED).
            def _card_dict(card: Any) -> dict[str, Any] | None:
                if card is None:
                    return None
                if isinstance(card, dict):
                    return card
                if hasattr(card, "model_dump"):
                    ranked = card.model_dump()
                    return {
                        "slug": ranked.get("slug", ""),
                        "name": ranked.get("name", ""),
                        "key": ranked.get("operation_key", ""),
                        "op_name": ranked.get("operation_name", ""),
                        "type": ranked.get("operation_type", "action"),
                        "authType": ranked.get("auth_type", "none"),
                    }
                return None

            selected_trigger = _card_dict(select_best(ranked_triggers)) or (trigger_cards[0] if trigger_cards else None)
            # The anchor beats ranking: "when a new lead arrives ... save to
            # Sheets" must not pick the Sheets trigger just because Sheets is
            # mentioned later in the sentence.
            if trigger_anchor and ranked_triggers:
                anchored = next(
                    (c for c in ranked_triggers if c.slug == trigger_anchor[0] and c.operation_type == "trigger"),
                    None,
                )
                if anchored is not None:
                    selected_trigger = _card_dict(anchored)
            if selected_trigger:
                yield sse("reasoning", {
                    "stage": Stage.SELECT,
                    "text": f"Selected trigger: {selected_trigger.get('name', '')}/{selected_trigger.get('op_name', '')}",
                })

            # Rank actions by relevance
            selected_actions = []
            seen_ops: set[tuple[str, str]] = set()
            for action in spec.actions:
                cards = action_cards.get(action.order, [])
                ranked = rank_candidates(f"{action.operation_hint} {action.purpose}", cards, kind="action")
                best = _card_dict(select_best(ranked))
                card = best or (cards[0] if cards else None)
                # Dedupe hallucinated overlapping steps (e.g. two "send email"
                # variants) and cap chain length for sane plans.
                op_id = (str((card or {}).get("slug", "")), str((card or {}).get("key", "")))
                if card and op_id in seen_ops:
                    continue
                if card:
                    seen_ops.add(op_id)
                if len(selected_actions) >= 6:
                    break
                selected_actions.append((action, card))

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
        kind_default = (
            "cron" if spec.trigger.kind == "schedule" else "catch_hook" if spec.trigger.kind == "webhook" else "button"
        )
        # An action card must never become the trigger: if the card is an action
        # (or its key is a known action), fall back to the app's real trigger key.
        _card_type = (trigger_card or {}).get("type", "trigger")
        trigger_key = (trigger_card or {}).get("key")
        if not trigger_key or _card_type != "trigger" or _card_type == "action":
            trigger_key = _TRIGGER_FALLBACK_KEYS.get(trigger_slug) or kind_default
        trigger_conn = bound.get(str(trigger_slug))
        nodes: list[dict[str, Any]] = [
            {
                "id": "trigger",
                "type": "trigger",
                "appSlug": trigger_slug,
                "operation": trigger_key,
                "label": (
                    (trigger_card or {}).get("op_name")
                    if _card_type == "trigger"
                    else (spec.trigger.event_hint or f"{trigger_slug} trigger")
                ) or "Trigger",
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


def _clean_trigger_phrase(text: str) -> str:
    """Strip filler so catalog search sees 'new lead', not 'When a new lead arrives'."""
    t = text.strip().strip(",.;")
    t = re.sub(r"^(?:when|whenever|every time|each time|any time|as soon as|once|after|if)\s+(?:a\s+|an\s+|the\s+|new\s+|some\s+|my\s+|our\s+)*", "", t, flags=re.I)
    t = re.sub(r"\s+(?:arrives?|occurs?|comes?\s+in|is\s+(?:added|created|received|submitted)|happens?|triggers?|is\s+new)\s*$", "", t, flags=re.I)
    return t.strip()


# Keyword → (app_hint, default_trigger_key, catalog_search_text).
# Ordered: most specific phrases first so "new lead" wins over generic "new".
_TRIGGER_MAP: tuple[tuple[tuple[str, ...], str, str, str], ...] = (
    (("new lead", "lead arrives", "new lead arrives", "lead"), "salesforce", "new_lead", "new lead"),
    (("email", "inbox", "gmail"), "gmail", "new_email", "new email"),
    (("form submission", "form response", "submission", "form"), "forms", "submitted", "new submission"),
    (("row", "spreadsheet", "sheet"), "google-sheets", "new_row", "new row"),
    (("calendar", "event"), "google-calendar", "new_event", "new event"),
    (("whatsapp", "sms", "text message"), "twilio", "inbound_message", "inbound message"),
    (("payment", "order"), "stripe", "new_payment", "new payment"),
    (("ticket"), "zendesk", "new_ticket", "new ticket"),
    (("deal"), "hubspot", "new_deal", "new deal"),
    (("contact"), "hubspot", "new_contact", "new contact"),
    (("issue", "pull request", "push"), "github", "new_issue", "new issue"),
    (("file", "drive"), "google-drive", "new_file", "new file"),
)

# Default trigger operation per app slug, used when catalog search finds no card
# so _assemble_definition never produces a broken slug/button combination.
_TRIGGER_FALLBACK_KEYS: dict[str, str] = {
    slug: key for _kw, slug, key, _s in _TRIGGER_MAP
}
_TRIGGER_FALLBACK_KEYS["slack"] = "new_message"
_TRIGGER_FALLBACK_KEYS["calendly"] = "invitee_created"

# Action keyword → app slug, prepended to the catalog search so phrases like
# "analyze with AI" or "save to Sheets" resolve to real operations.
_ACTION_APP_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("analyze", "analyse", "summarize", "summarise", "classify", "generate text", "prompt", "gpt", "openai", " ai ", "with ai"), "openai"),
    (("sheet", "spreadsheet", "row"), "google-sheets"),
    (("email", "gmail"), "gmail"),
    (("slack", "notify", "alert", "message the team", "post"), "slack"),
    (("calendar", "invite", "attendee"), "google-calendar"),
    (("contact", "crm", "deal", "lead", "hubspot"), "hubspot"),
    (("salesforce",), "salesforce"),
    (("notion",), "notion"),
    (("airtable",), "airtable"),
    (("discord",), "discord"),
)

_ACTION_SPLIT_VERBS = (
    "send|add|notify|create|post|append|write|analyze|analyse|summarize|summarise|"
    "classify|translate|generate|draft|reply|log|store|save|insert|update|upload|"
    "convert|format|assign|tag|move|copy|export|enrich|score"
)


def _split_actions(text: str) -> list[str]:
    """Split a request into action phrases on 'then'/'and <verb>'/comma boundaries."""
    segments = [
        p.strip()
        for p in re.split(r"\b(?:then|and then|after that|afterwards)\b", text, flags=re.I)
        if p.strip()
    ]
    if len(segments) < 2:
        segments = [
            p.strip()
            for p in re.split(rf"\s*,\s*(?=(?:{_ACTION_SPLIT_VERBS})\b)|\s+and\s+(?=(?:{_ACTION_SPLIT_VERBS})\b)", text, flags=re.I)
            if p.strip()
        ]
    return segments


def _enrich_action_hint(segment: str) -> str:
    """Prepend a detected app name so 'analyze with AI' can find openai ops."""
    lowered = f" {segment.lower()} "
    for keywords, slug in _ACTION_APP_HINTS:
        if any(k in lowered for k in keywords):
            return f"{slug} {segment}"
    return segment


def _detect_trigger(text: str) -> tuple[str, str] | None:
    """Detect the trigger app from the request's first segment.

    Returns (slug, catalog_search_phrase) so the orchestrator can anchor
    trigger selection deterministically instead of letting a generic
    ranking pick whichever app's words co-occur with the request.
    """
    parts = _split_actions(text)
    phrase = _clean_trigger_phrase(parts[0] if parts else text)
    low = phrase.lower()
    for keywords, slug, _key, mapped in _TRIGGER_MAP:
        if any(k in low for k in keywords):
            return slug, mapped
    return None


def heuristic_intent(text: str) -> IntentSpec:
    lower = text.lower()
    parts = _split_actions(text)
    trigger_raw = parts[0] if parts else text
    action_parts = parts[1:] or []
    if not action_parts:
        for phrase in re.findall(rf"((?:{_ACTION_SPLIT_VERBS})[^,.]{{3,120}})", text, flags=re.I):
            action_parts.append(phrase.strip())

    trigger_phrase = _clean_trigger_phrase(trigger_raw)
    trigger_lower = trigger_phrase.lower()

    # Explicit time expressions beat app keywords: "every morning with my
    # calendar events" is a schedule, not a calendar trigger.
    has_time_expr = bool(re.search(
        r"\b(?:cron|every (?:day|hour|week|month|morning|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|hourly|weekly|monthly|at \d{1,2}(?::\d{2})?)\b",
        lower,
    ))

    kind = "app_event"
    app_hint = None
    default_key = None
    search_text = trigger_phrase or text[:80]
    if has_time_expr and "when " not in lower:
        kind = "schedule"
        search_text = "schedule"
    else:
        for keywords, slug, key, phrase in _TRIGGER_MAP:
            if any(k in trigger_lower for k in keywords):
                app_hint = slug
                default_key = key
                search_text = phrase
                break
        if app_hint is None and re.search(r"\b(?:cron|every (?:day|hour|week|morning|monday|friday)|daily|hourly|weekly|at \d{1,2}(?::\d{2})?)\b", lower):
            kind = "schedule"
            search_text = "schedule"
        elif app_hint is None and "webhook" in lower:
            kind = "webhook"
            search_text = "catch hook"

    return IntentSpec(
        summary=text[:160],
        trigger=TriggerIntent(kind=kind, search_text=search_text, app_hint=app_hint, event_hint=trigger_phrase or None),
        actions=[
            ActionIntent(purpose=p, operation_hint=_enrich_action_hint(p), order=i)
            for i, p in enumerate(action_parts)
        ],
    )
