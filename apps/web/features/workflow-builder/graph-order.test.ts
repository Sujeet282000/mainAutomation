import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";
import { executionOrderIds, orderNodesByGraph, stepNumbers, nodeStepNumber } from "./graph-order";
import type { StepData } from "./store";

function node(id: string, kind: StepData["kind"] = "action"): Node<StepData> {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: { label: id, kind, appSlug: "test", operation: "run", config: {} },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target };
}

describe("workflow graph ordering", () => {
  it("uses edges instead of node-array position", () => {
    const nodes = [node("a"), node("c"), node("trigger", "trigger"), node("b")];
    const edges = [edge("trigger", "a"), edge("a", "b"), edge("b", "c")];
    expect(executionOrderIds(nodes, edges)).toEqual(["trigger", "a", "b", "c"]);
    expect(orderNodesByGraph(nodes, edges).map((n) => n.id)).toEqual(["trigger", "a", "b", "c"]);
  });

  it("keeps inserted nodes in the correct linear position", () => {
    const nodes = [node("trigger", "trigger"), node("a"), node("b"), node("inserted")];
    const edges = [edge("trigger", "a"), edge("a", "inserted"), edge("inserted", "b")];
    expect(executionOrderIds(nodes, edges)).toEqual(["trigger", "a", "inserted", "b"]);
  });

  it("does not recurse forever on cycles", () => {
    const nodes = [node("trigger", "trigger"), node("a"), node("b")];
    const edges = [edge("trigger", "a"), edge("a", "b"), edge("b", "a")];
    expect(executionOrderIds(nodes, edges)).toEqual(["trigger", "a", "b"]);
  });

  it("assigns 1..N step numbers from edges, independent of array order", () => {
    const nodes = [node("trigger", "trigger"), node("e"), node("c"), node("b"), node("a")];
    const edges = [edge("trigger", "a"), edge("a", "b"), edge("b", "c"), edge("c", "e")];
    const numbers = stepNumbers(nodes, edges);
    expect(numbers.get("trigger")).toBe(1);
    expect(numbers.get("a")).toBe(2);
    expect(numbers.get("b")).toBe(3);
    expect(numbers.get("c")).toBe(4);
    expect(numbers.get("e")).toBe(5);
    expect(nodeStepNumber("e", nodes, edges)).toBe(5);
  });

  it("numbers inserted nodes in graph order, not append order", () => {
    // Trigger → a → b, then insert X between them.
    const nodes = [node("trigger", "trigger"), node("a"), node("b"), node("x")];
    const edges = [edge("trigger", "a"), edge("a", "x"), edge("x", "b")];
    const numbers = stepNumbers(nodes, edges);
    expect(numbers.get("trigger")).toBe(1);
    expect(numbers.get("a")).toBe(2);
    expect(numbers.get("x")).toBe(3);
    expect(numbers.get("b")).toBe(4);
  });

  it("numbers parallel branch children deterministically", () => {
    const nodes = [node("trigger", "trigger"), node("filter"), node("left"), node("right")];
    const edges = [edge("trigger", "filter"), edge("filter", "left"), edge("filter", "right")];
    const numbers = stepNumbers(nodes, edges);
    expect(numbers.get("trigger")).toBe(1);
    expect(numbers.get("filter")).toBe(2);
    expect(numbers.get("left")).toBeLessThan(numbers.get("right")!);
  });
});
