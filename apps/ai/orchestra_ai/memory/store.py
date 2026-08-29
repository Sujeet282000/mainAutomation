"""
Agent Memory Store
==================

Three memory tiers with explicit auditable storage:

1. **Conversation memory** — current session context
2. **Workflow memory** — facts about a specific workflow
3. **Workspace memory** — reusable organizational preferences

Every memory write is:
- Explicit (not hidden chain-of-thought)
- Auditable (stored with timestamp, source, reason)
- Bounded (max entries per tier)
- Controllable (user can view/delete memories)
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class MemoryTier(str, Enum):
    CONVERSATION = "conversation"  # current session
    WORKFLOW = "workflow"          # facts about a specific workflow
    WORKSPACE = "workspace"        # reusable org preferences


class MemoryEntry(BaseModel):
    """A single memory entry."""
    id: str = ""
    tier: MemoryTier
    key: str                     # e.g. "notification_preference:sales_alert"
    value: Any                   # the stored fact
    source: str = "user"         # user | system | correction | preference
    reason: str = ""             # why this was stored
    workflow_id: str | None = None
    workspace_id: str | None = None
    created_at: float = Field(default_factory=time.time)
    expires_at: float | None = None
    confidence: float = 1.0


class MemoryStore:
    """
    In-memory memory store with persistence hooks.

    In production, this would write to a database.
    For now, it stores in memory with structured access.
    """

    def __init__(self, max_conversation: int = 50, max_workflow: int = 100, max_workspace: int = 200):
        self._conversation: list[MemoryEntry] = []
        self._workflow: dict[str, list[MemoryEntry]] = {}  # workflow_id → entries
        self._workspace: dict[str, list[MemoryEntry]] = {}  # workspace_id → entries
        self._max_conversation = max_conversation
        self._max_workflow = max_workflow
        self._max_workspace = max_workspace
        self._audit_log: list[dict[str, Any]] = []

    # ── Conversation Memory ──────────────────────────────────────────────

    def remember_conversation(self, key: str, value: Any, source: str = "user", reason: str = "") -> MemoryEntry:
        """Store a conversation-scoped fact."""
        entry = MemoryEntry(
            id=f"conv_{len(self._conversation)}",
            tier=MemoryTier.CONVERSATION,
            key=key,
            value=value,
            source=source,
            reason=reason,
        )
        self._conversation.append(entry)
        if len(self._conversation) > self._max_conversation:
            self._conversation = self._conversation[-self._max_conversation:]
        self._audit("remember", entry)
        return entry

    def recall_conversation(self, query: str = "", limit: int = 10) -> list[MemoryEntry]:
        """Recall conversation memories, optionally filtered by query."""
        if not query:
            return self._conversation[-limit:]
        query_lower = query.lower()
        return [m for m in self._conversation if query_lower in m.key.lower() or query_lower in str(m.value).lower()][-limit:]

    def clear_conversation(self) -> int:
        """Clear all conversation memory. Returns count cleared."""
        count = len(self._conversation)
        self._conversation.clear()
        self._audit("clear_conversation", None, count=count)
        return count

    # ── Workflow Memory ──────────────────────────────────────────────────

    def remember_workflow(self, workflow_id: str, key: str, value: Any, source: str = "system", reason: str = "") -> MemoryEntry:
        """Store a fact about a specific workflow."""
        entry = MemoryEntry(
            tier=MemoryTier.WORKFLOW,
            key=key,
            value=value,
            source=source,
            reason=reason,
            workflow_id=workflow_id,
        )
        entries = self._workflow.setdefault(workflow_id, [])
        entries.append(entry)
        if len(entries) > self._max_workflow:
            self._workflow[workflow_id] = entries[-self._max_workflow:]
        self._audit("remember_workflow", entry)
        return entry

    def recall_workflow(self, workflow_id: str, query: str = "", limit: int = 20) -> list[MemoryEntry]:
        """Recall memories about a specific workflow."""
        entries = self._workflow.get(workflow_id, [])
        if not query:
            return entries[-limit:]
        query_lower = query.lower()
        return [m for m in entries if query_lower in m.key.lower() or query_lower in str(m.value).lower()][-limit:]

    # ── Workspace Memory ─────────────────────────────────────────────────

    def remember_workspace(self, workspace_id: str, key: str, value: Any, source: str = "user", reason: str = "") -> MemoryEntry:
        """Store a workspace-wide preference."""
        entry = MemoryEntry(
            tier=MemoryTier.WORKSPACE,
            key=key,
            value=value,
            source=source,
            reason=reason,
            workspace_id=workspace_id,
        )
        entries = self._workspace.setdefault(workspace_id, [])
        # Replace existing entry with same key
        entries = [e for e in entries if e.key != key]
        entries.append(entry)
        if len(entries) > self._max_workspace:
            entries = entries[-self._max_workspace:]
        self._workspace[workspace_id] = entries
        self._audit("remember_workspace", entry)
        return entry

    def recall_workspace(self, workspace_id: str, query: str = "", limit: int = 50) -> list[MemoryEntry]:
        """Recall workspace-wide preferences."""
        entries = self._workspace.get(workspace_id, [])
        if not query:
            return entries[-limit:]
        query_lower = query.lower()
        return [m for m in entries if query_lower in m.key.lower() or query_lower in str(m.value).lower()][-limit:]

    # ── Correction Learning ──────────────────────────────────────────────

    def record_correction(self, workspace_id: str, original_key: str, new_value: Any, reason: str = "") -> MemoryEntry:
        """
        Record a user correction. This is how the system learns from feedback.

        Example:
            User: "No, send sales alerts to WhatsApp, not Slack"
            → record_correction(ws, "sales_alert_channel", "whatsapp", "user corrected from Slack")
        """
        entry = self.remember_workspace(
            workspace_id,
            key=original_key,
            value=new_value,
            source="correction",
            reason=reason,
        )
        self._audit("correction", entry)
        return entry

    # ── Context Assembly ─────────────────────────────────────────────────

    def assemble_context(
        self,
        workspace_id: str | None = None,
        workflow_id: str | None = None,
        query: str = "",
    ) -> str:
        """
        Assemble all relevant memories into a context string
        for injection into the model prompt.
        """
        parts = []

        # Conversation memories
        conv = self.recall_conversation(query, limit=10)
        if conv:
            parts.append("Conversation memory:")
            for m in conv:
                parts.append(f"  - {m.key}: {m.value}")

        # Workflow memories
        if workflow_id:
            wf = self.recall_workflow(workflow_id, query, limit=10)
            if wf:
                parts.append(f"\nWorkflow memories ({workflow_id[:8]}):")
                for m in wf:
                    parts.append(f"  - {m.key}: {m.value}")

        # Workspace memories
        if workspace_id:
            ws = self.recall_workspace(workspace_id, query, limit=15)
            if ws:
                parts.append(f"\nWorkspace preferences:")
                for m in ws:
                    parts.append(f"  - {m.key}: {m.value}")

        return "\n".join(parts) if parts else ""

    # ── Audit Log ────────────────────────────────────────────────────────

    def _audit(self, action: str, entry: MemoryEntry | None, **extra: Any) -> None:
        self._audit_log.append({
            "action": action,
            "entry_id": entry.id if entry else None,
            "tier": entry.tier.value if entry else None,
            "key": entry.key if entry else None,
            "timestamp": time.time(),
            **extra,
        })

    def get_audit_log(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._audit_log[-limit:]

    # ── Stats ────────────────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        return {
            "conversation": len(self._conversation),
            "workflow": {k: len(v) for k, v in self._workflow.items()},
            "workspace": {k: len(v) for k, v in self._workspace.items()},
            "total_audit_entries": len(self._audit_log),
        }


# ── Singleton ─────────────────────────────────────────────────────────────

_store: MemoryStore | None = None


def get_memory_store() -> MemoryStore:
    global _store
    if _store is None:
        _store = MemoryStore()
    return _store
