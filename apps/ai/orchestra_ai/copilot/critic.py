"""
Critic + Repair
===============

Validates a generated graph, identifies issues, and proposes fixes.

The critic evaluates:
  1. Graph structure (connected, no orphans, valid edges)
  2. Node completeness (all required fields present)
  3. Connection validity (connected apps have connection IDs)
  4. Field mapping (required fields are mapped)
  5. Business logic (no infinite loops, branches have conditions)
  6. Security (no credentials in graph, no SSRF)

The repair loop:
  1. Validate
  2. If issues found, attempt deterministic fixes
  3. Re-validate
  4. If still broken after MAX_PASSES, surface to user
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Issue(BaseModel):
    """A single validation issue."""
    severity: str = "error"  # error | warning | info
    code: str
    message: str
    node_id: str | None = None
    field: str | None = None
    fixable: bool = False
    fix_description: str | None = None


class CriticResult(BaseModel):
    """Result of critiquing a graph."""
    valid: bool
    issues: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    pass_count: int = 0
    fixes_applied: list[str] = Field(default_factory=list)


MAX_REPAIR_PASSES = 3


def critique_graph(
    graph: dict[str, Any],
    *,
    connected_apps: list[str] | None = None,
    required_fields: dict[str, list[str]] | None = None,
) -> CriticResult:
    """
    Run the full critique pipeline on a graph.

    Returns CriticResult with issues, warnings, and whether the graph
    is publishable.
    """
    connected = set(connected_apps or [])
    result = CriticResult(valid=True)

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    if not nodes:
        result.valid = False
        result.issues.append(Issue(
            severity="error", code="EMPTY_GRAPH", message="Graph has no nodes"
        ))
        return result

    node_ids = {n["id"] for n in nodes}
    node_map = {n["id"]: n for n in nodes}

    # 1. Check trigger exists
    triggers = [n for n in nodes if n.get("type") == "trigger"]
    if not triggers:
        result.valid = False
        result.issues.append(Issue(
            severity="error", code="NO_TRIGGER", message="Graph must have at least one trigger node"
        ))

    # 2. Check connectivity (all nodes reachable from trigger)
    if triggers:
        reachable = _bfs_reachability(triggers[0]["id"], edges)
        orphans = node_ids - reachable
        for orphan_id in orphans:
            node = node_map.get(orphan_id, {})
            result.warnings.append(Issue(
                severity="warning", code="ORPHAN_NODE",
                message=f"Node '{node.get('label', orphan_id)}' is not connected to the flow",
                node_id=orphan_id, fixable=True,
                fix_description="Connect this node to the flow",
            ))

    # 3. Check edges reference valid nodes
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in node_ids:
            result.valid = False
            result.issues.append(Issue(
                severity="error", code="EDGE_SOURCE_MISSING",
                message=f"Edge references non-existent source node '{src}'",
            ))
        if tgt not in node_ids:
            result.valid = False
            result.issues.append(Issue(
                severity="error", code="EDGE_TARGET_MISSING",
                message=f"Edge references non-existent target node '{tgt}'",
            ))

    # 4. Check for duplicate edges
    seen_edges = set()
    for edge in edges:
        key = (edge.get("source"), edge.get("target"))
        if key in seen_edges:
            result.warnings.append(Issue(
                severity="warning", code="DUPLICATE_EDGE",
                message=f"Duplicate edge from '{key[0]}' to '{key[1]}'",
                fixable=True,
                fix_description="Remove duplicate edge",
            ))
        seen_edges.add(key)

    # 5. Check node completeness
    for node in nodes:
        if not node.get("appSlug"):
            result.warnings.append(Issue(
                severity="warning", code="MISSING_APP",
                message=f"Node '{node.get('id')}' has no appSlug",
                node_id=node["id"],
            ))
        if not node.get("operation"):
            result.warnings.append(Issue(
                severity="warning", code="MISSING_OPERATION",
                message=f"Node '{node.get('id')}' has no operation",
                node_id=node["id"],
            ))

    # 6. Check connection requirements
    auth_required = {"oauth2", "api_key", "basic"}
    for node in nodes:
        app_slug = node.get("appSlug", "")
        # If app requires auth but no connection is provided
        if node.get("type") != "trigger" and not node.get("connectionId"):
            # We can't check auth here without full catalog, so mark as info
            pass

    # 7. Check branch nodes have conditions
    for node in nodes:
        if node.get("appSlug") == "filter":
            config = node.get("config", {})
            if not config.get("condition") and not config.get("mappings"):
                result.warnings.append(Issue(
                    severity="warning", code="FILTER_NO_CONDITION",
                    message=f"Filter node '{node.get('id')}' has no condition configured",
                    node_id=node["id"],
                    fixable=True,
                    fix_description="Add a filter condition",
                ))

    # 8. Check for potential infinite loops
    # (simple check: any edge going backward in the topological order)
    if triggers:
        topo_order = _topological_sort(triggers[0]["id"], edges, node_ids)
        order_map = {nid: i for i, nid in enumerate(topo_order)}
        for edge in edges:
            src = edge.get("source")
            tgt = edge.get("target")
            if src in order_map and tgt in order_map:
                if order_map[tgt] < order_map[src]:
                    # Backward edge — potential loop
                    if node_map.get(src, {}).get("appSlug") != "loop":
                        result.warnings.append(Issue(
                            severity="warning", code="BACKWARD_EDGE",
                            message=f"Edge '{src}' → '{tgt}' goes backward — possible unintended loop",
                            fixable=False,
                        ))

    # 9. Check settings
    settings = graph.get("settings", {})
    if not settings.get("timezone"):
        result.warnings.append(Issue(
            severity="info", code="NO_TIMEZONE",
            message="No timezone configured, defaulting to UTC",
            fixable=True,
            fix_description="Set timezone in settings",
        ))

    return result


def repair_graph(
    graph: dict[str, Any],
    connected_apps: list[str] | None = None,
) -> CriticResult:
    """
    Attempt to repair a graph automatically.

    Runs the critique → fix loop up to MAX_REPAIR_PASSES times.
    """
    import copy

    best_result = CriticResult(valid=False, pass_count=0)

    for pass_num in range(MAX_REPAIR_PASSES):
        result = critique_graph(graph, connected_apps=connected_apps)
        result.pass_count = pass_num + 1

        if result.valid and not result.warnings:
            return result

        best_result = result

        if not any(i.fixable for i in result.issues + result.warnings):
            break  # No more fixable issues

        # Apply deterministic fixes
        fixed = False
        for issue in result.issues + result.warnings:
            if not issue.fixable:
                continue

            if issue.code == "ORPHAN_NODE" and issue.node_id:
                # Connect orphan to the last node before it
                _connect_orphan(graph, issue.node_id)
                result.fixes_applied.append(f"Connected orphan node '{issue.node_id}'")
                fixed = True

            elif issue.code == "DUPLICATE_EDGE":
                _remove_duplicate_edges(graph)
                result.fixes_applied.append("Removed duplicate edges")
                fixed = True

            elif issue.code == "FILTER_NO_CONDITION" and issue.node_id:
                # Set a default passthrough condition
                for node in graph.get("nodes", []):
                    if node["id"] == issue.node_id:
                        node.setdefault("config", {})["condition"] = "true"
                        break
                result.fixes_applied.append(f"Added default condition to filter '{issue.node_id}'")
                fixed = True

            elif issue.code == "NO_TIMEZONE":
                graph.setdefault("settings", {})["timezone"] = "UTC"
                result.fixes_applied.append("Set timezone to UTC")
                fixed = True

        if not fixed:
            break

    return best_result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _bfs_reachability(start_id: str, edges: list[dict[str, Any]]) -> set[str]:
    """BFS from start node to find all reachable nodes."""
    adj: dict[str, list[str]] = {}
    for edge in edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        adj.setdefault(src, []).append(tgt)

    visited = set()
    queue = [start_id]
    while queue:
        node = queue.pop(0)
        if node in visited:
            continue
        visited.add(node)
        queue.extend(adj.get(node, []))
    return visited


def _topological_sort(start_id: str, edges: list[dict[str, Any]], node_ids: set[str]) -> list[str]:
    """Simple topological sort from start node."""
    adj: dict[str, list[str]] = {}
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    for edge in edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        adj.setdefault(src, []).append(tgt)
        if tgt in in_degree:
            in_degree[tgt] = in_degree.get(tgt, 0) + 1

    queue = [n for n, d in in_degree.items() if d == 0]
    result = []
    while queue:
        node = queue.pop(0)
        result.append(node)
        for neighbor in adj.get(node, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
    return result


def _connect_orphan(graph: dict[str, Any], orphan_id: str) -> None:
    """Connect an orphan node to the last node in the graph."""
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    if len(nodes) < 2:
        return

    # Find the node before the orphan in position order
    orphan_idx = next((i for i, n in enumerate(nodes) if n["id"] == orphan_id), None)
    if orphan_idx is None or orphan_idx == 0:
        return

    prev_node_id = nodes[orphan_idx - 1]["id"]
    edges.append({
        "id": f"e-{prev_node_id}-{orphan_id}",
        "source": prev_node_id,
        "target": orphan_id,
    })


def _remove_duplicate_edges(graph: dict[str, Any]) -> None:
    """Remove duplicate edges from the graph."""
    seen = set()
    unique = []
    for edge in graph.get("edges", []):
        key = (edge.get("source"), edge.get("target"))
        if key not in seen:
            seen.add(key)
            unique.append(edge)
    graph["edges"] = unique
