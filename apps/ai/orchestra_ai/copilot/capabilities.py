# ============================================================================
# Orchestra Part 8 — Capability Envelope
# Source of truth: Part 8 § "The capability envelope"
# Before any code that touches data, the boundary is declared as data and
# checked by a function. It is never a string match or a comment.
# ============================================================================

from __future__ import annotations


class CopilotForbidden(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(f"COPILOT_FORBIDDEN: {code}")


# What Copilot MAY do (allow-list)
ALLOWED_CAPABILITIES = {
    "select_existing_connection",
    "read_operation_schemas",
    "read_sample_output",
    "request_trigger_sample",
    "write_draft",
    "add_step",
    "set_field",
    "add_logic",
    "compile_condition",
    "refine_draft",
    "suggest_next_steps",
}

# What Copilot may NEVER do (deny-list, enforced in code)
FORBIDDEN_CAPABILITIES = {
    "publish_flow",
    "create_credential",
    "read_credential_secret",
    "execute_write_action",
    "delete_flow",
    "change_billing",
    "impersonate_user",
    "access_connection_plaintext",
    "call_external_apis",
}


def require(capability: str) -> None:
    """Assert that a capability is allowed. Raises CopilotForbidden if not."""
    if capability in FORBIDDEN_CAPABILITIES:
        raise CopilotForbidden(capability)
    if capability not in ALLOWED_CAPABILITIES:
        raise CopilotForbidden(f"UNKNOWN_CAPABILITY: {capability}")
