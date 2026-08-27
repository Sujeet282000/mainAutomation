import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCopilotChapter,
  fillEmptyFields,
  inspectDraft,
  orchestrateCopilot
} from "./copilot-orchestrator";
import { copilotChat, copilotGraph, shouldBuildFromChat } from "./copilot";
import type { WorkflowGraph } from "@algoverge/shared";

function gmailSheetsDraft(): WorkflowGraph {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "gmail",
        operation: "new_email",
        label: "New Email",
        position: { x: 280, y: 40 },
        config: {},
        connectionId: "conn-gmail"
      },
      {
        id: "sheets-clear",
        type: "action",
        appSlug: "google-sheets",
        operation: "clear_row",
        label: "Clear Spreadsheet Row(s)",
        position: { x: 280, y: 200 },
        config: {},
        connectionId: "conn-sheets"
      }
    ],
    edges: [{ id: "e1", source: "trigger", target: "sheets-clear" }]
  };
}

function threeStepDraft(): WorkflowGraph {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "gmail",
        operation: "new_email",
        label: "New Email",
        position: { x: 0, y: 0 },
        config: {},
        connectionId: "c1"
      },
      {
        id: "filter",
        type: "logic",
        appSlug: "filter",
        operation: "only_continue_if",
        label: "Filter",
        position: { x: 0, y: 160 },
        config: { left: "{{trigger.subject}}", operator: "contains", right: "invoice" }
      },
      {
        id: "slack",
        type: "action",
        appSlug: "slack",
        operation: "send_message",
        label: "Send Channel Message",
        position: { x: 0, y: 320 },
        config: {},
        connectionId: null
      }
    ],
    edges: [
      { id: "e1", source: "trigger", target: "filter" },
      { id: "e2", source: "filter", target: "slack" }
    ]
  };
}

test("inspectDraft sees manually created Gmail and Sheets nodes and their chapters", () => {
  const snap = inspectDraft(gmailSheetsDraft());
  assert.equal(snap.nodeCount, 2);
  assert.equal(snap.generic, false);
  assert.equal(snap.steps[0].appSlug, "gmail");
  assert.equal(snap.steps[0].chapter, "test");
  assert.equal(snap.steps[1].appSlug, "google-sheets");
  assert.equal(snap.steps[1].chapter, "configure");
  assert.ok(snap.steps[1].missingFields.length >= 1);
  assert.match(snap.outline, /gmail/i);
  assert.match(snap.outline, /google-sheets/i);
});

test("filling step 2 maps empty fields without rebuilding or mutating the Gmail trigger", async () => {
  const draft: WorkflowGraph = {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "gmail",
        operation: "new_email",
        label: "New Email",
        position: { x: 280, y: 40 },
        config: {},
        connectionId: "conn-gmail"
      },
      {
        id: "sheets-append",
        type: "action",
        appSlug: "google-sheets",
        operation: "append_row",
        label: "Append Row",
        position: { x: 280, y: 200 },
        config: {},
        connectionId: "conn-sheets"
      }
    ],
    edges: [{ id: "e1", source: "trigger", target: "sheets-append" }]
  };
  const prompt = "Fill out the fields in step '2. Append Row' for me please.";
  assert.equal(classifyCopilotChapter(prompt, inspectDraft(draft), "sheets-append"), "fill_fields");
  assert.equal(shouldBuildFromChat(prompt, draft, "sheets-append"), false);

  const turn = orchestrateCopilot({ prompt, graph: draft, selectedStepId: "sheets-append" });
  assert.equal(turn.rebuilt, false);
  assert.equal(turn.changed, true);
  assert.equal(turn.graph?.nodes.find((n) => n.id === "trigger")?.appSlug, "gmail");
  assert.equal(turn.graph?.nodes.find((n) => n.id === "trigger")?.connectionId, "conn-gmail");
  assert.equal(turn.graph?.nodes.find((n) => n.id === "sheets-append")?.operation, "append_row");
  assert.match(String(turn.graph?.nodes.find((n) => n.id === "sheets-append")?.config.values), /trigger/);
  assert.equal(turn.graph?.nodes.find((n) => n.id === "sheets-append")?.config.spreadsheetId, undefined);

  const chat = await copilotChat({ prompt, graph: draft, selectedStepId: "sheets-append", mode: "auto_build" });
  assert.equal(chat.graph?.nodes.length, 2);
  assert.equal(chat.graph?.nodes[0].id, "trigger");
  assert.equal(chat.graph?.nodes[0].appSlug, "gmail");
  assert.equal(chat.graph?.nodes[1].id, "sheets-append");
});

test("filling a Clear Row step does not invent a spreadsheet id or replace nodes", () => {
  const turn = orchestrateCopilot({
    prompt: "Fill out the fields in step '2. Clear Spreadsheet Row(s)' for me please.",
    graph: gmailSheetsDraft(),
    selectedStepId: "sheets-clear"
  });
  assert.equal(turn.rebuilt, false);
  assert.equal(turn.graph?.nodes[0].appSlug, "gmail");
  assert.equal(turn.graph?.nodes[1].operation, "clear_row");
  assert.equal(turn.graph?.nodes[1].config.spreadsheetId, undefined);
  assert.match(turn.reply, /did not guess|keep|existing|spreadsheet/i);
});

test("generate-style orchestrator keeps a 3-node manual draft when asked to autocomplete", async () => {
  const draft = threeStepDraft();
  const result = await copilotGraph("autocomplete remaining fields", null, {
    graph: draft,
    mode: "auto_build"
  });
  assert.equal(result.rebuilt, false);
  assert.equal(result.graph.nodes.map((n) => n.id).join(","), "trigger,filter,slack");
  assert.equal(result.graph.nodes[0].appSlug, "gmail");
  assert.equal(result.graph.nodes[1].appSlug, "filter");
  assert.equal(result.graph.nodes[1].config.right, "invoice");
  assert.equal(result.graph.nodes[2].appSlug, "slack");
});

test("Copilot names the human-only next step before offering to fill fields", async () => {
  const draft: WorkflowGraph = {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "google-calendar",
        operation: "new_event",
        label: "New Event",
        position: { x: 0, y: 0 },
        config: {},
        connectionId: null
      }
    ],
    edges: []
  };
  const snap = inspectDraft(draft);
  assert.match(snap.youDoFirst?.[0] ?? "", /connect/i);
  const chat = await copilotChat({ prompt: "Fill this step", graph: draft });
  assert.equal(chat.graph, undefined);
  assert.match(chat.reply, /Do this first/i);
  assert.match(chat.youDoFirst?.[0] ?? "", /connect/i);
  assert.match(chat.reply, /cannot fill|connect google calendar/i);
});

test("Copilot inspects before mutating and answers with current issues", async () => {
  const result = await copilotChat({
    prompt: "What is happening in this workflow and what should I do next?",
    graph: gmailSheetsDraft()
  });
  assert.equal(result.graph, undefined);
  assert.match(result.reply, /Inspected|2-step|Clear Spreadsheet|google-sheets/i);
  assert.match(result.reply, /Do this first|I cannot|Connect|Choose/i);
});

test("ask as you build still classifies fill as a patch, not a rebuild", () => {
  const draft = gmailSheetsDraft();
  const turn = orchestrateCopilot({
    prompt: "Map the empty fields on the Sheets step",
    graph: draft,
    selectedStepId: "sheets-clear",
    mode: "ask_as_you_build"
  });
  assert.equal(turn.chapter, "fill_fields");
  assert.equal(turn.rebuilt, false);
});

test("adding Slack appends a node and preserves Gmail plus Sheets", () => {
  const turn = orchestrateCopilot({ prompt: "add a slack step", graph: gmailSheetsDraft() });
  assert.equal(turn.chapter, "add_step");
  assert.equal(turn.graph?.nodes.length, 3);
  assert.equal(turn.graph?.nodes[0].appSlug, "gmail");
  assert.equal(turn.graph?.nodes[1].appSlug, "google-sheets");
  assert.equal(turn.graph?.nodes[2].appSlug, "slack");
});

test("add new node creates an editable blank action when no app is named", () => {
  const turn = orchestrateCopilot({ prompt: "add new node", graph: gmailSheetsDraft() });
  assert.equal(turn.chapter, "add_step");
  assert.equal(turn.changed, true);
  assert.equal(turn.graph?.nodes.length, 3);
  assert.equal(turn.graph?.nodes.at(-1)?.appSlug, "");
  assert.match(turn.reply, /added a blank next step/i);
});

test("then notify in Slack appends a next step without rebuilding", () => {
  const turn = orchestrateCopilot({ prompt: "then also send a Slack message", graph: gmailSheetsDraft() });
  assert.equal(turn.chapter, "add_step");
  assert.equal(turn.graph?.nodes.at(-1)?.appSlug, "slack");
  assert.match(turn.reply, /Added slack|Do this first/i);
});

test("explicit rebuild is the only chapter that replaces a catalog draft", () => {
  const draft = gmailSheetsDraft();
  assert.equal(classifyCopilotChapter("rebuild from scratch with HubSpot", inspectDraft(draft)), "rebuild");
  assert.equal(shouldBuildFromChat("rebuild from scratch with HubSpot", draft), true);
  assert.equal(shouldBuildFromChat("fill step 2", draft), false);
  assert.equal(shouldBuildFromChat("When a Gmail arrives, add a Google Sheets row", draft), false);
  assert.equal(shouldBuildFromChat("build a workflow for slack", draft), false);
});

test("generate-style copilotGraph still preserves a multi-node manual draft outside the staged-engine route", async () => {
  const draft = threeStepDraft();
  const result = await copilotGraph("When a Gmail arrives, add a Google Sheets row", null, {
    graph: draft,
    mode: "auto_build"
  });
  assert.equal(result.rebuilt, false);
  assert.equal(result.changed, false);
  assert.equal(result.chapter, "inspect");
  assert.deepEqual(
    result.graph.nodes.map((n) => n.id),
    ["trigger", "filter", "slack"]
  );
  assert.equal(result.graph.nodes[0].appSlug, "gmail");
  assert.equal(result.graph.nodes[1].config.right, "invoice");
  assert.match(result.summary, /Inspected your 3-step|gmail|slack|Do this first/i);
});

test("autocomplete across four mixed nodes only fills empty fields", async () => {
  const draft: WorkflowGraph = {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "gmail",
        operation: "new_email",
        label: "New Email",
        position: { x: 0, y: 0 },
        config: {},
        connectionId: "c1"
      },
      {
        id: "cal",
        type: "action",
        appSlug: "google-calendar",
        operation: "create_event",
        label: "Create Event",
        position: { x: 0, y: 160 },
        config: { calendarId: "primary", summary: "Keep this title" },
        connectionId: "c2"
      },
      {
        id: "http",
        type: "action",
        appSlug: "http",
        operation: "request",
        label: "HTTP Request",
        position: { x: 0, y: 320 },
        config: {}
      },
      {
        id: "slack",
        type: "action",
        appSlug: "slack",
        operation: "send_message",
        label: "Send Channel Message",
        position: { x: 0, y: 480 },
        config: { text: "already mapped" },
        connectionId: null
      }
    ],
    edges: [
      { id: "e1", source: "trigger", target: "cal" },
      { id: "e2", source: "cal", target: "http" },
      { id: "e3", source: "http", target: "slack" }
    ]
  };
  const result = await copilotGraph("autocomplete remaining fields", null, { graph: draft, mode: "auto_build" });
  assert.equal(result.rebuilt, false);
  assert.equal(result.graph.nodes.length, 4);
  assert.equal(result.graph.nodes[1].config.summary, "Keep this title");
  assert.equal(result.graph.nodes[3].config.text, "already mapped");
  assert.equal(result.graph.nodes[2].appSlug, "http");
  assert.ok(result.graph.nodes[2].config.url);
});

test("fillEmptyFields never overwrites user-provided config", () => {
  const graph = gmailSheetsDraft();
  graph.nodes[1].config = { spreadsheetId: "sheet-user", sheet: "Sheet1", row: "keep-me" };
  const filled = fillEmptyFields(graph, "sheets-clear");
  assert.equal(filled.graph.nodes[1].config.spreadsheetId, "sheet-user");
  assert.equal(filled.graph.nodes[1].config.row, "keep-me");
  assert.equal(filled.filledKeys.length, 0);
});

test("starter canvas may rebuild; configured canvas may not on a fill prompt", () => {
  const starter: WorkflowGraph = {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "",
        operation: "",
        label: "Trigger",
        position: { x: 0, y: 0 },
        config: {}
      }
    ],
    edges: []
  };
  assert.equal(shouldBuildFromChat("when a gmail arrives add a sheets row", starter), true);
  assert.equal(shouldBuildFromChat("when a gmail arrives add a sheets row", gmailSheetsDraft()), false);
});
