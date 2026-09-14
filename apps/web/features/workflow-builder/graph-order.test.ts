import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";
import { executionOrderIds, orderNodesByGraph } from "./graph-order";
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
});
