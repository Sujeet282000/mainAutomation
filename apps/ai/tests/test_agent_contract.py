import pytest
from pydantic import ValidationError

from orchestra_ai.copilot.agent import AgentReply


def test_agent_reply_can_answer_without_workflow_mutation() -> None:
    reply = AgentReply(message="The workflow has one trigger and one action.")
    assert reply.message
    assert reply.intent == "answer"
    assert reply.operations == []
    assert reply.needs_input == []


def test_agent_reply_keeps_mutations_explicit() -> None:
    reply = AgentReply.model_validate(
        {
            "message": "I can add the WhatsApp step.",
            "intent": "modify_workflow",
            "confidence": 0.92,
            "plan": ["Add WhatsApp after the current action."],
            "operations": [
                {
                    "kind": "add_node",
                    "arguments": {"appSlug": "whatsapp", "operation": "send_message"},
                    "requires_confirmation": False,
                }
            ],
        }
    )
    assert reply.operations[0].kind == "add_node"
    assert reply.operations[0].requires_confirmation is False
    assert reply.intent == "modify_workflow"
    assert reply.confidence == 0.92


def test_agent_reply_rejects_unknown_operation_kind() -> None:
    with pytest.raises(ValidationError):
        AgentReply.model_validate(
            {
                "message": "Do something",
                "operations": [{"kind": "invent_operation", "arguments": {}}],
            }
        )
