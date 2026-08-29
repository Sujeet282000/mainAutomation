import type { WorkflowGraph } from "@algoverge/shared";
import { completeAi, screenOutput } from "./ai-runtime";
import { diagnoseFromFailure } from "./diagnose";
import { inspectDraft } from "./copilot/copilot-orchestrator";

export type WorkflowAdviceInput = {
  graph?: WorkflowGraph;
  lastTest?: { ok?: boolean; body?: unknown; ms?: number } | null;
};

/** A compact, secret-free snapshot given to the reasoning model. */
export function workflowState(input: WorkflowAdviceInput) {
  const snapshot = inspectDraft(input.graph);
  return {
    outline: snapshot.outline,
    issues: snapshot.issues,
    steps: snapshot.steps.map((step) => ({ index: step.index, label: step.label, chapter: step.chapter, issues: step.issues })),
    lastTest: input.lastTest ? { ok: Boolean(input.lastTest.ok), ms: input.lastTest.ms, body: input.lastTest.body } : null
  };
}

export function deterministicWorkflowAdvice(input: WorkflowAdviceInput) {
  const state = workflowState(input);
  if (input.lastTest && !input.lastTest.ok) {
    const diagnosis = diagnoseFromFailure({ runError: input.lastTest.body });
    return `${diagnosis.cause}\n\nNext: ${diagnosis.userFix}`;
  }
  const blocked = state.steps.find((step) => step.issues.length);
  if (blocked) return `Do this first: configure step ${blocked.index} (${blocked.label}). ${blocked.issues.join(" ")}`;
  if (state.steps.length) {
    return `Your flow is configured: ${state.outline}. Next, run Test workflow to execute the steps in order. Review the run, then publish yourself.`;
  }
  return "Your canvas is empty. Describe the trigger and actions you want, and I will build a draft.";
}

/**
 * Read-only orchestration layer for the builder. It can reason over current
 * workflow state and test evidence, but cannot publish, create credentials, or
 * invoke third-party tools. When no model is configured it remains useful via
 * deterministic, evidence-based advice.
 */
export async function adviseWorkflow(input: WorkflowAdviceInput) {
  const fallback = deterministicWorkflowAdvice(input);
  const state = workflowState(input);
  const answer = await completeAi({
    intent: "reason",
    piiFilter: true,
    system:
      "You are a read-only workflow orchestration advisor. Use only the supplied workflow state. Explain the current state and one concrete next action. Do not claim actions were performed. Never ask for or expose credentials. Never publish.",
    prompt: JSON.stringify(state)
  });
  const screened = screenOutput(answer.text);
  const text = screened.text.trim();
  // Some generic AI-service fallbacks return a valid but useless JSON reply
  // (for example `{"type":"reply","text":"Noted."}`). Do not replace
  // evidence-based guidance unless the model actually references this flow.
  const labels = state.steps.map((step) => step.label.toLowerCase());
  const referencesState = labels.some((label) => label && text.toLowerCase().includes(label)) || /test workflow|connect|configure|gmail api|publish/i.test(text);
  return screened.allowed && text && referencesState ? text : fallback;
}
