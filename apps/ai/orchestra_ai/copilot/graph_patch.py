"""
Graph Patch Engine
==================

Instead of rebuilding the entire workflow graph, the Copilot produces
a list of typed operations. Deterministic code applies them safely.

This is the core upgrade that makes:
  - "Add Slack after this step" safe
  - "Remove the last step" safe
  - "Change Gmail to Outlook" safe
  - "Replace Slack with WhatsApp" safe
  - "Map the sender email to the contact" safe

Every patch is validated before application.
"""

from __future__ import annotations

import copy
import re
import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class PatchOp(str, Enum):
    ADD_NODE = "add_node"
    REMOVE_NODE = "remove_node"
    UPDATE_NODE = "update_node"
    REPLACE_NODE = "replace_node"
    CONNECT = "connect"
    DISCONNECT = "disconnect"
    UPDATE_CONFIG = "update_config"
    MAP_FIELD = "map_field"
    ADD_BRANCH = "add_branch"
    REMOVE_BRANCH = "remove_branch"
    ADD_DELAY = "add_delay"
    ADD_APPROVAL = "add_approval"


class GraphPatch(BaseModel):
    """A single atomic operation on the graph."""
    op: PatchOp
    target_node_id: str | None = None
    after_node_id: str | None = None
    before_node_id: str | None = None
    node: dict[str, Any] | None = None
    source: str | None = None
    target: str | None = None
    field: str | None = None
    value: Any = None
    expression: str | None = None
    config: dict[str, Any] | None = None


class PatchResult(BaseModel):
    """Result of applying a patch to a graph."""
    graph: dict[str, Any]
    applied: list[dict[str, Any]] = Field(default_factory=list)
    rejected: list[dict[str, Any]] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    changed: bool = False


def apply_patches(
    graph: dict[str, Any],
    patches: list[GraphPatch],
) -> PatchResult:
    """
    Apply a list of patches to a workflow graph deterministically.

    Returns a PatchResult with the modified graph, applied/rejected patches,
    and any issues encountered. The original graph is never mutated.
    """
    result = PatchResult(graph=copy.deepcopy(graph), changed=False)

    for patch in patches:
        ok, issue = _validate_patch(patch, result.graph)
        if not ok:
            result.rejected.append({"op": patch.op.value, "target": patch.target_node_id, "issue": issue})
            result.issues.append(issue)
            continue

        _apply_one(patch, result.graph)
        result.applied.append({"op": patch.op.value, "target": patch.target_node_id})
        result.changed = True

    # Rebuild edges after structural changes
    _normalize_edges(result.graph)

    return result


def _validate_patch(patch: GraphPatch, graph: dict[str, Any]) -> tuple[bool, str]:
    """Validate a single patch before applying. Returns (ok, issue)."""
    nodes = graph.get("nodes", [])
    node_ids = {n["id"] for n in nodes}

    if patch.op == PatchOp.ADD_NODE:
        if not patch.node:
            return False, "add_node requires a node definition"
        if not patch.after_node_id and not patch.before_node_id:
            return False, "add_node requires after_node_id or before_node_id"
        if patch.after_node_id and patch.after_node_id not in node_ids:
            return False, f"after_node_id '{patch.after_node_id}' not found"
        if patch.before_node_id and patch.before_node_id not in node_ids:
            return False, f"before_node_id '{patch.before_node_id}' not found"

    elif patch.op == PatchOp.REMOVE_NODE:
        if not patch.target_node_id:
            return False, "remove_node requires target_node_id"
        if patch.target_node_id not in node_ids:
            return False, f"node '{patch.target_node_id}' not found"
        if patch.target_node_id == "trigger":
            return False, "cannot remove the trigger node"

    elif patch.op == PatchOp.UPDATE_NODE:
        if not patch.target_node_id:
            return False, "update_node requires target_node_id"
        if patch.target_node_id not in node_ids:
            return False, f"node '{patch.target_node_id}' not found"

    elif patch.op == PatchOp.REPLACE_NODE:
        if not patch.target_node_id or not patch.node:
            return False, "replace_node requires target_node_id and node"
        if patch.target_node_id not in node_ids:
            return False, f"node '{patch.target_node_id}' not found"

    elif patch.op == PatchOp.CONNECT:
        if not patch.source or not patch.target:
            return False, "connect requires source and target"
        if patch.source not in node_ids:
            return False, f"source node '{patch.source}' not found"
        if patch.target not in node_ids:
            return False, f"target node '{patch.target}' not found"

    elif patch.op == PatchOp.DISCONNECT:
        if not patch.source or not patch.target:
            return False, "disconnect requires source and target"

    elif patch.op == PatchOp.MAP_FIELD:
        if not patch.target_node_id:
            return False, "map_field requires target_node_id"
        if patch.target_node_id not in node_ids:
            return False, f"node '{patch.target_node_id}' not found"
        if not patch.field:
            return False, "map_field requires field"

    elif patch.op == PatchOp.UPDATE_CONFIG:
        if not patch.target_node_id:
            return False, "update_config requires target_node_id"
        if patch.target_node_id not in node_ids:
            return False, f"node '{patch.target_node_id}' not found"

    return True, ""


def _apply_one(patch: GraphPatch, graph: dict[str, Any]) -> None:
    """Apply a single validated patch to the graph (mutates in place)."""
    nodes = graph.setdefault("nodes", [])
    edges = graph.setdefault("edges", [])

    if patch.op == PatchOp.ADD_NODE:
        new_node = _ensure_id(patch.node.copy())
        # Position the new node
        if patch.after_node_id:
            anchor = next((n for n in nodes if n["id"] == patch.after_node_id), None)
            if anchor:
                pos = anchor.get("position", {"x": 280, "y": 40})
                new_node["position"] = {"x": pos.get("x", 280), "y": pos.get("y", 40) + 160}
            idx = next((i for i, n in enumerate(nodes) if n["id"] == patch.after_node_id), len(nodes) - 1)
            nodes.insert(idx + 1, new_node)
        elif patch.before_node_id:
            idx = next((i for i, n in enumerate(nodes) if n["id"] == patch.before_node_id), 0)
            anchor = nodes[idx] if idx < len(nodes) else None
            if anchor:
                pos = anchor.get("position", {"x": 280, "y": 40})
                new_node["position"] = {"x": pos.get("x", 280), "y": max(0, pos.get("y", 40) - 160)}
            nodes.insert(idx, new_node)

        # Auto-connect: after→new and new→before (if both exist)
        if patch.after_node_id and patch.before_node_id:
            # Remove direct after→before edge
            edges[:] = [e for e in edges if not (e.get("source") == patch.after_node_id and e.get("target") == patch.before_node_id)]
            _auto_connect(edges, patch.after_node_id, new_node["id"])
            _auto_connect(edges, new_node["id"], patch.before_node_id)
        elif patch.after_node_id:
            _auto_connect(edges, patch.after_node_id, new_node["id"])
        elif patch.before_node_id:
            _auto_connect(edges, new_node["id"], patch.before_node_id)

    elif patch.op == PatchOp.REMOVE_NODE:
        # Remove the node
        graph["nodes"] = [n for n in nodes if n["id"] != patch.target_node_id]
        # Reconnect: find edges into and out of the removed node
        incoming = [e for e in edges if e.get("target") == patch.target_node_id]
        outgoing = [e for e in edges if e.get("source") == patch.target_node_id]
        # Remove all edges involving the node
        graph["edges"] = [e for e in edges if e.get("source") != patch.target_node_id and e.get("target") != patch.target_node_id]
        # Reconnect: for each incoming source → each outgoing target
        for inc in incoming:
            for out in outgoing:
                _auto_connect(graph["edges"], inc["source"], out["target"])

    elif patch.op == PatchOp.UPDATE_NODE:
        for node in nodes:
            if node["id"] == patch.target_node_id:
                if patch.node:
                    node.update(patch.node)
                    node["id"] = patch.target_node_id  # preserve id
                break

    elif patch.op == PatchOp.REPLACE_NODE:
        for i, node in enumerate(nodes):
            if node["id"] == patch.target_node_id:
                replacement = patch.node.copy()
                replacement["id"] = patch.target_node_id  # preserve id
                replacement["position"] = node.get("position", {"x": 280, "y": 40})
                nodes[i] = replacement
                break

    elif patch.op == PatchOp.CONNECT:
        # Avoid duplicates
        existing = {(e.get("source"), e.get("target")) for e in edges}
        if (patch.source, patch.target) not in existing:
            edges.append({"id": f"e-{patch.source}-{patch.target}", "source": patch.source, "target": patch.target})

    elif patch.op == PatchOp.DISCONNECT:
        graph["edges"] = [
            e for e in edges
            if not (e.get("source") == patch.source and e.get("target") == patch.target)
        ]

    elif patch.op == PatchOp.MAP_FIELD:
        for node in nodes:
            if node["id"] == patch.target_node_id:
                config = node.setdefault("config", {})
                mappings = config.setdefault("mappings", {})
                if patch.expression:
                    mappings[patch.field] = patch.expression
                elif patch.value is not None:
                    mappings[patch.field] = patch.value
                break

    elif patch.op == PatchOp.UPDATE_CONFIG:
        for node in nodes:
            if node["id"] == patch.target_node_id:
                config = node.setdefault("config", {})
                if patch.config:
                    config.update(patch.config)
                break

    elif patch.op == PatchOp.ADD_DELAY:
        # Add a delay node after the target
        delay_id = _unique_id("delay", {n["id"] for n in nodes})
        delay_node = {
            "id": delay_id,
            "type": "logic",
            "appSlug": "delay",
            "operation": "for",
            "label": "Delay",
            "position": {"x": 280, "y": 200},
            "config": {"delay": patch.value or 5, "unit": "seconds"},
        }
        # Insert after target
        idx = next((i for i, n in enumerate(nodes) if n["id"] == patch.target_node_id), len(nodes) - 1)
        nodes.insert(idx + 1, delay_node)
        # Reconnect
        outgoing = [e for e in edges if e.get("source") == patch.target_node_id]
        graph["edges"] = [e for e in edges if e.get("source") != patch.target_node_id]
        _auto_connect(graph["edges"], patch.target_node_id, delay_id)
        for out in outgoing:
            _auto_connect(graph["edges"], delay_id, out["target"])

    elif patch.op == PatchOp.ADD_APPROVAL:
        # Add an approval step after the target
        approval_id = _unique_id("approval", {n["id"] for n in nodes})
        approval_node = {
            "id": approval_id,
            "type": "logic",
            "appSlug": "approval",
            "operation": "approve",
            "label": "Approval Required",
            "position": {"x": 280, "y": 200},
            "config": {"prompt": patch.value or "Approve this action?"},
        }
        idx = next((i for i, n in enumerate(nodes) if n["id"] == patch.target_node_id), len(nodes) - 1)
        nodes.insert(idx + 1, approval_node)
        outgoing = [e for e in edges if e.get("source") == patch.target_node_id]
        graph["edges"] = [e for e in edges if e.get("source") != patch.target_node_id]
        _auto_connect(graph["edges"], patch.target_node_id, approval_id)
        for out in outgoing:
            _auto_connect(graph["edges"], approval_id, out["target"])


def _auto_connect(edges: list, source: str, target: str) -> None:
    """Add a connection if it doesn't already exist."""
    existing = {(e.get("source"), e.get("target")) for e in edges}
    if (source, target) not in existing:
        edges.append({"id": f"e-{source}-{target}", "source": source, "target": target})


def _ensure_id(node: dict[str, Any]) -> dict[str, Any]:
    """Ensure a node has an ID."""
    if not node.get("id"):
        node["id"] = _unique_id(node.get("appSlug", "step"), {node.get("id", "")})
    return node


def _unique_id(hint: str, used: set[str]) -> str:
    """Generate a unique ID based on a hint."""
    slug = re.sub(r"[^a-z0-9]+", "_", hint.lower()).strip("_")[:30]
    candidate = slug or "step"
    n = 2
    while candidate in used:
        candidate = f"{slug}_{n}"
        n += 1
    return candidate


def _normalize_edges(graph: dict[str, Any]) -> None:
    """Ensure all edges reference existing nodes and have IDs."""
    node_ids = {n["id"] for n in graph.get("nodes", [])}
    valid_edges = []
    for edge in graph.get("edges", []):
        if edge.get("source") in node_ids and edge.get("target") in node_ids:
            if not edge.get("id"):
                edge["id"] = f"e-{edge['source']}-{edge['target']}"
            valid_edges.append(edge)
    graph["edges"] = valid_edges


# ── Natural Language → Patch Translation ─────────────────────────────────────

def describe_patches(patches: list[GraphPatch], graph: dict[str, Any]) -> list[str]:
    """Generate human-readable descriptions of what each patch does."""
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    descriptions = []

    for p in patches:
        if p.op == PatchOp.ADD_NODE:
            app = (p.node or {}).get("appSlug", "unknown")
            op = (p.node or {}).get("operation", "")
            anchor = p.after_node_id or p.before_node_id or ""
            anchor_name = nodes.get(anchor, {}).get("label", anchor)
            descriptions.append(f"Add {app} {op} after {anchor_name}")

        elif p.op == PatchOp.REMOVE_NODE:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            descriptions.append(f"Remove {name}")

        elif p.op == PatchOp.REPLACE_NODE:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            app = (p.node or {}).get("appSlug", "unknown")
            descriptions.append(f"Replace {name} with {app}")

        elif p.op == PatchOp.MAP_FIELD:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            expr = p.expression or str(p.value)
            descriptions.append(f"Map {p.field} on {name} to {expr}")

        elif p.op == PatchOp.CONNECT:
            src = nodes.get(p.source, {}).get("label", p.source)
            tgt = nodes.get(p.target, {}).get("label", p.target)
            descriptions.append(f"Connect {src} → {tgt}")

        elif p.op == PatchOp.DISCONNECT:
            src = nodes.get(p.source, {}).get("label", p.source)
            tgt = nodes.get(p.target, {}).get("label", p.target)
            descriptions.append(f"Disconnect {src} → {tgt}")

        elif p.op == PatchOp.ADD_DELAY:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            descriptions.append(f"Add delay after {name}")

        elif p.op == PatchOp.ADD_APPROVAL:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            descriptions.append(f"Add approval gate after {name}")

        elif p.op == PatchOp.UPDATE_CONFIG:
            name = nodes.get(p.target_node_id, {}).get("label", p.target_node_id)
            descriptions.append(f"Update config on {name}")

    return descriptions
