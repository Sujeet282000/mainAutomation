import { StepNode } from "./step-node";

/**
 * React Flow looks up `node.type` in this map. Saved graphs use trigger/action/logic.
 * If those values are passed through without remapping, unregistered types render blank.
 */
export const canvasNodeTypes = {
  step: StepNode,
  trigger: StepNode,
  action: StepNode,
  logic: StepNode,
  default: StepNode,
  input: StepNode,
  output: StepNode
};
