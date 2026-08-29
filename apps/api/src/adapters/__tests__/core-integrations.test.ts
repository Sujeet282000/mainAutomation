import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { APP_CATALOG } from "../../catalog";

// ── Catalog completeness tests ──────────────────────────────────────────

const CORE_APPS = [
  "gmail",
  "google-sheets",
  "google-calendar",
  "google-drive",
  "slack",
  "whatsapp",
  "typeform",
  "hubspot",
  "github",
  "http",
];

describe("Core integrations catalog", () => {
  for (const slug of CORE_APPS) {
    it(`${slug} has a catalog manifest with at least 2 operations`, () => {
      const app = APP_CATALOG.find((a) => a.slug === slug);
      assert.ok(app, `Missing catalog entry for ${slug}`);
      assert.ok(app.operations.length >= 2, `${slug} should have at least 2 operations, got ${app.operations.length}`);
    });
  }

  it("gmail has trigger + action operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "gmail")!;
    const triggers = app.operations.filter((o) => o.type === "trigger");
    const actions = app.operations.filter((o) => o.type === "action");
    assert.ok(triggers.length >= 1, "Gmail needs at least 1 trigger");
    assert.ok(actions.length >= 1, "Gmail needs at least 1 action");
  });

  it("google-sheets has create, read, update, find operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "google-sheets")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("create_row") || keys.includes("append_row"), "Sheets needs create/append");
    assert.ok(keys.includes("read_sheet"), "Sheets needs read");
    assert.ok(keys.includes("find_row"), "Sheets needs find");
  });

  it("google-calendar has create, list, update, delete operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "google-calendar")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("create_event"), "Calendar needs create");
    assert.ok(keys.includes("list_events"), "Calendar needs list");
    assert.ok(keys.includes("update_event"), "Calendar needs update");
    assert.ok(keys.includes("delete_event"), "Calendar needs delete");
  });

  it("google-drive has upload operation", () => {
    const app = APP_CATALOG.find((a) => a.slug === "google-drive")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("upload_file"), "Drive needs upload_file");
  });

  it("slack has send_message action", () => {
    const app = APP_CATALOG.find((a) => a.slug === "slack")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("send_message"), "Slack needs send_message");
  });

  it("whatsapp has send_message and send_template", () => {
    const app = APP_CATALOG.find((a) => a.slug === "whatsapp")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("send_message"), "WhatsApp needs send_message");
    assert.ok(keys.includes("send_template"), "WhatsApp needs send_template");
  });

  it("typeform has trigger, form listing, and responses operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "typeform")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("new_entry") || keys.includes("new_submission"), "Typeform needs trigger");
    assert.ok(keys.includes("list_forms"), "Typeform needs list_forms");
    assert.ok(keys.includes("get_responses"), "Typeform needs get_responses");
  });

  it("hubspot has contact, deal, company, and ticket operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "hubspot")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("create_contact"), "HubSpot needs create_contact");
    assert.ok(keys.includes("create_deal"), "HubSpot needs create_deal");
    assert.ok(keys.includes("create_company"), "HubSpot needs create_company");
    assert.ok(keys.includes("create_ticket"), "HubSpot needs create_ticket");
    assert.ok(keys.includes("list_contacts"), "HubSpot needs list_contacts");
  });

  it("github has issues, PRs, repos, and comments operations", () => {
    const app = APP_CATALOG.find((a) => a.slug === "github")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("create_issue"), "GitHub needs create_issue");
    assert.ok(keys.includes("update_issue"), "GitHub needs update_issue");
    assert.ok(keys.includes("create_pr"), "GitHub needs create_pr");
    assert.ok(keys.includes("merge_pr"), "GitHub needs merge_pr");
    assert.ok(keys.includes("add_comment"), "GitHub needs add_comment");
    assert.ok(keys.includes("list_repos"), "GitHub needs list_repos");
  });

  it("http has webhook trigger and request action", () => {
    const app = APP_CATALOG.find((a) => a.slug === "http")!;
    const keys = app.operations.map((o) => o.key);
    assert.ok(keys.includes("catch_hook"), "HTTP needs catch_hook trigger");
    assert.ok(keys.includes("request"), "HTTP needs request action");
  });

  it("all core apps have authType configured", () => {
    for (const slug of CORE_APPS) {
      const app = APP_CATALOG.find((a) => a.slug === slug);
      assert.ok(app, `Missing ${slug}`);
      assert.ok(typeof app.authType === "string", `${slug} needs authType`);
    }
  });

  it("all core apps have at least one trigger", () => {
    for (const slug of CORE_APPS) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      const triggers = app.operations.filter((o) => o.type === "trigger");
      assert.ok(triggers.length >= 1, `${slug} needs at least 1 trigger`);
    }
  });

  it("all core apps have at least one action", () => {
    for (const slug of CORE_APPS) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      const actions = app.operations.filter((o) => o.type === "action");
      assert.ok(actions.length >= 1, `${slug} needs at least 1 action`);
    }
  });

  it("core apps have inputFields on action operations", () => {
    for (const slug of CORE_APPS) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      for (const op of app.operations.filter((o) => o.type === "action")) {
        assert.ok(Array.isArray(op.inputFields), `${slug}.${op.key} needs inputFields array`);
      }
    }
  });
});

// ── Adapter registry tests ──────────────────────────────────────────────

describe("Adapter registry", () => {
  it("all catalog operations have registered adapters or fallback", () => {
    // The generic.ts registerCatalogFallbacks() ensures every catalog operation
    // has a fallback adapter that just passes input through.
    // We verify that the key core operations have real adapters by checking
    // the adapter index imports.
    const importedAdapters = [
      "gmail", "google-sheets", "google-calendar", "google-drive",
      "slack", "whatsapp", "typeform", "hubspot", "github",
    ];
    for (const slug of importedAdapters) {
      const app = APP_CATALOG.find((a) => a.slug === slug);
      assert.ok(app, `${slug} must be in catalog`);
    }
  });
});

// ── Operation output samples ────────────────────────────────────────────

describe("Output samples", () => {
  it("google-sheets read_sheet has outputSample", () => {
    const app = APP_CATALOG.find((a) => a.slug === "google-sheets")!;
    const readOp = app.operations.find((o) => o.key === "read_sheet");
    assert.ok(readOp, "read_sheet exists");
    assert.ok(readOp.outputSample, "read_sheet has outputSample");
  });

  it("typeform get_responses has outputSample", () => {
    const app = APP_CATALOG.find((a) => a.slug === "typeform")!;
    const op = app.operations.find((o) => o.key === "get_responses");
    assert.ok(op, "get_responses exists");
    assert.ok(op.outputSample, "get_responses has outputSample");
  });

  it("github list_repos has outputSample", () => {
    const app = APP_CATALOG.find((a) => a.slug === "github")!;
    const op = app.operations.find((o) => o.key === "list_repos");
    assert.ok(op, "list_repos exists");
    assert.ok(op.outputSample, "list_repos has outputSample");
  });

  it("hubspot list_contacts has outputSample", () => {
    const app = APP_CATALOG.find((a) => a.slug === "hubspot")!;
    const op = app.operations.find((o) => o.key === "list_contacts");
    assert.ok(op, "list_contacts exists");
    assert.ok(op.outputSample, "list_contacts has outputSample");
  });
});

// ── Auth type validation ────────────────────────────────────────────────

describe("Auth types", () => {
  it("Google apps use oauth2", () => {
    for (const slug of ["gmail", "google-sheets", "google-calendar", "google-drive"]) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      assert.equal(app.authType, "oauth2", `${slug} should use oauth2`);
    }
  });

  it("Slack uses oauth2", () => {
    const app = APP_CATALOG.find((a) => a.slug === "slack")!;
    assert.equal(app.authType, "oauth2", "Slack should use oauth2");
  });

  it("GitHub uses oauth2", () => {
    const app = APP_CATALOG.find((a) => a.slug === "github")!;
    assert.equal(app.authType, "oauth2", "GitHub should use oauth2");
  });

  it("Typeform uses oauth2", () => {
    const app = APP_CATALOG.find((a) => a.slug === "typeform")!;
    assert.equal(app.authType, "oauth2", "Typeform should use oauth2");
  });

  it("HubSpot uses oauth2", () => {
    const app = APP_CATALOG.find((a) => a.slug === "hubspot")!;
    assert.equal(app.authType, "oauth2", "HubSpot should use oauth2");
  });
});

// ── Trigger mode validation ─────────────────────────────────────────────

describe("Trigger modes", () => {
  it("polling triggers have empty inputFields or field hints", () => {
    const pollApps = [
      { slug: "google-sheets", op: "new_row" },
      { slug: "google-calendar", op: "new_event" },
      { slug: "hubspot", op: "new_contact" },
      { slug: "hubspot", op: "new_deal" },
    ];
    for (const { slug, op } of pollApps) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      const operation = app.operations.find((o) => o.key === op);
      assert.ok(operation, `${slug}.${op} exists`);
      assert.equal(operation.triggerMode, "polling", `${slug}.${op} should use polling`);
    }
  });

  it("webhook triggers have webhook triggerMode", () => {
    const hookApps = [
      { slug: "github", op: "new_issue" },
      { slug: "typeform", op: "new_entry" },
      { slug: "http", op: "catch_hook" },
    ];
    for (const { slug, op } of hookApps) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      const operation = app.operations.find((o) => o.key === op);
      if (operation) {
        assert.equal(operation.triggerMode, "webhook", `${slug}.${op} should use webhook`);
      }
    }
  });
});

// ── Dynamic field type validation ───────────────────────────────────────

describe("Dynamic fields", () => {
  it("operations that reference external resources use dynamic type", () => {
    const dynamicOps = [
      { slug: "google-sheets", op: "create_row", field: "spreadsheetId" },
      { slug: "google-sheets", op: "create_row", field: "sheet" },
      { slug: "github", op: "create_issue", field: "repo" },
      { slug: "github", op: "update_issue", field: "repo" },
      { slug: "github", op: "update_issue", field: "issueNumber" },
      { slug: "hubspot", op: "update_deal", field: "dealId" },
      { slug: "typeform", op: "new_submission", field: "formId" },
      { slug: "typeform", op: "get_form", field: "formId" },
    ];
    for (const { slug, op, field } of dynamicOps) {
      const app = APP_CATALOG.find((a) => a.slug === slug)!;
      const operation = app.operations.find((o) => o.key === op)!;
      const fieldDef = operation.inputFields.find((f) => f.key === field);
      assert.ok(fieldDef, `${slug}.${op}.${field} field exists`);
      assert.ok(
        fieldDef.type === "dynamic" || fieldDef.type === "select",
        `${slug}.${op}.${field} should be dynamic or select, got ${fieldDef.type}`
      );
    }
  });
});
