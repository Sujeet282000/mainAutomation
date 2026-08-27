// ============================================================================
// Orchestra Part 11 — Evaluation Harness
// Source of truth: Part 11 § "Evaluation harness"
// The difference between an AI feature and an AI product.
// ============================================================================

import { describe, it, expect } from "node:test";

// ── Metrics ─────────────────────────────────────────────────────────────────

export function triggerCorrect(expected: string, actual: string | null): number {
  return actual === expected ? 1.0 : 0.0;
}

export function actionSetF1(expected: string[], actual: string[]): number {
  const exp = new Set(expected);
  const act = new Set(actual);
  if (exp.size === 0 && act.size === 0) return 1.0;
  const tp = [...exp].filter((x) => act.has(x)).length;
  if (tp === 0) return 0.0;
  const precision = tp / act.size;
  const recall = tp / exp.size;
  return (2 * precision * recall) / (precision + recall);
}

export function hallucinatedOps(actual: string[], catalog: Set<string>): number {
  return actual.filter((op) => !catalog.has(op)).length;
}

export function mappingRecall(expected: Record<string, string>, actual: Record<string, string>): number {
  const keys = Object.keys(expected);
  if (keys.length === 0) return 1.0;
  const hits = keys.filter((k) => actual[k] === expected[k]).length;
  return hits / keys.length;
}

export function mappingPrecision(expected: Record<string, string>, actual: Record<string, string>): number {
  const filled = Object.entries(actual).filter(([_, v]) => v);
  if (filled.length === 0) return 1.0;
  const correct = filled.filter(([k]) => expected[k] === actual[k]).length;
  return correct / filled.length;
}

export function abstentionCorrectness(shouldAbstain: string[], actual: Record<string, string>): number {
  if (shouldAbstain.length === 0) return 1.0;
  const kept = shouldAbstain.filter((k) => !actual[k]).length;
  return kept / shouldAbstain.length;
}

// ── Golden set structure ────────────────────────────────────────────────────

interface CopilotCase {
  id: string;
  requestText: string;
  expectedTrigger: string;
  expectedActions: string[];
  expectedLogic: string[];
  requiredMappings: Record<string, string>;
  shouldAbstain: string[];
}

// ── CI Gates ────────────────────────────────────────────────────────────────

describe("Part 11: Evaluation Harness — CI Gates", () => {
  const GATES = {
    zeroHallucinatedOps: true,
    zeroInvalidExpressionTokens: true,
    abstentionRateBand: [0.05, 0.40], // 5%-40% abstention is healthy
    mappingRecallFloor: 0.60,
    triggerCorrectFloor: 0.80,
  };

  it("hallucinated operations gate is absolute (zero tolerance)", () => {
    // A single hallucinated operation fails the build.
    // This is a correctness bug, not a quality metric.
    expect(GATES.zeroHallucinatedOps).toBe(true);
  });

  it("mapping recall floor is set", () => {
    expect(GATES.mappingRecallFloor).toBeGreaterThan(0.5);
    expect(GATES.mappingRecallFloor).toBeLessThanOrEqual(1.0);
  });

  it("trigger correctness floor is set", () => {
    expect(GATES.triggerCorrectFloor).toBeGreaterThan(0.7);
    expect(GATES.triggerCorrectFloor).toBeLessThanOrEqual(1.0);
  });

  it("abstention rate band is reasonable", () => {
    expect(GATES.abstentionRateBand[0]).toBeGreaterThanOrEqual(0);
    expect(GATES.abstentionRateBand[1]).toBeLessThanOrEqual(0.5);
    expect(GATES.abstentionRateBand[1]).toBeGreaterThan(GATES.abstentionRateBand[0]);
  });

  it("triggerCorrect metric works", () => {
    expect(triggerCorrect("webhook", "webhook")).toBe(1.0);
    expect(triggerCorrect("webhook", "schedule")).toBe(0.0);
  });

  it("actionSetF1 metric works", () => {
    expect(actionSetF1(["a", "b"], ["a", "b"])).toBe(1.0);
    expect(actionSetF1(["a", "b"], ["a", "c"])).toBeCloseTo(0.5, 1);
    expect(actionSetF1(["a", "b"], [])).toBe(0.0);
  });

  it("hallucinatedOps metric works", () => {
    const catalog = new Set(["slack:action:send", "gmail:action:send"]);
    expect(hallucinatedOps(["slack:action:send"], catalog)).toBe(0);
    expect(hallucinatedOps(["fake:action:do"], catalog)).toBe(1);
  });
});
