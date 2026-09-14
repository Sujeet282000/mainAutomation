import { describe, expect, it } from "vitest";
import { wouldCreateCycle, hasCycle } from "./graph-validation";
import type { Edge } from "reactflow";

function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target };
}

describe("graph validation", () => {
  it("allows a forward connection", () => {
    const edges = [edge("a", "b")];
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
  });

  it("rejects a direct back-edge", () => {
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("rejects a longer back-edge through the graph", () => {
    const edges = [edge("trigger", "a"), edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "b", "trigger")).toBe(true);
  });

  it("rejects self-connections", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("treats empty ids as invalid, not cyclic", () => {
    expect(wouldCreateCycle([], "", "a")).toBe(false);
    expect(wouldCreateCycle([], "a", "")).toBe(false);
  });

  it("detects an existing cycle in the edge set", () => {
    expect(hasCycle([edge("a", "b"), edge("b", "a")])).toBe(true);
    expect(hasCycle([edge("a", "b"), edge("b", "c")])).toBe(false);
    expect(hasCycle([edge("trigger", "a"), edge("a", "b"), edge("b", "a")])).toBe(true);
  });
});
