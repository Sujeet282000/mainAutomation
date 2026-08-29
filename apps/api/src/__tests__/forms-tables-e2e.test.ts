/**
 * E2E Test: Form Submission → Table Row → Automation Execution
 *
 * Tests the complete flow:
 * 1. Create a table with fields
 * 2. Create a form connected to that table
 * 3. Create a workflow with form trigger → table action
 * 4. Submit data through the public form endpoint
 * 5. Verify table row was created
 * 6. Verify workflow was triggered
 *
 * Run: npx tsx --test apps/api/src/__tests__/forms-tables-e2e.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";

const API_URL = process.env.API_URL || "http://localhost:4000/api/v1";
const TEST_EMAIL = `e2e-test-${Date.now()}@test.com`;
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "E2E Test User";

let authToken: string;
let orgId: string;
let testTableId: string;
let testFormId: string;
let testFormSlug: string;
let testWorkflowId: string;

// ── Helper functions ─────────────────────────────────────────────────────────

async function apiCall<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (orgId) headers["x-workspace-id"] = orgId;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  }
  return data as T;
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe("Forms → Tables → Automation E2E", () => {
  before(async () => {
    // Register and login
    try {
      const reg = await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: TEST_NAME,
        }),
      });
      authToken = reg.token;
      orgId = reg.organization?.id || reg.workspace?.id;
    } catch (e: any) {
      // If registration fails (user exists), try login
      const login = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });
      authToken = login.token;
      orgId = login.organization?.id || login.workspace?.id;
    }

    assert(authToken, "Should get auth token");
    assert(orgId, "Should get org ID");
  });

  after(async () => {
    // Cleanup: delete test resources
    if (testFormId) {
      await apiCall(`/forms/${testFormId}`, { method: "DELETE" }).catch(() => {});
    }
    if (testTableId) {
      await apiCall(`/tables/${testTableId}`, { method: "DELETE" }).catch(() => {});
    }
    if (testWorkflowId) {
      await apiCall(`/flows/${testWorkflowId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  // ── Step 1: Create a Table ───────────────────────────────────────────────

  it("should create a test table with fields", async () => {
    const result = await apiCall<{ table: { id: string; name: string } }>("/tables", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Test Leads",
        schema: {
          fields: [
            { key: "name", type: "text", label: "Name" },
            { key: "email", type: "email", label: "Email" },
            { key: "company", type: "text", label: "Company" },
            { key: "score", type: "number", label: "Lead Score" },
          ],
        },
      }),
    });

    assert(result.table?.id, "Table should have an ID");
    testTableId = result.table.id;
    console.log(`  ✓ Created table: ${testTableId}`);
  });

  // ── Step 2: Create a Form connected to the Table ────────────────────────

  it("should create a form connected to the table", async () => {
    const slug = `e2e-test-form-${Date.now()}`;
    const result = await apiCall<{ form: { id: string; name: string } }>("/forms", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Test Form",
        slug,
        fields: [
          { key: "name", type: "text", label: "Name" },
          { key: "email", type: "email", label: "Email" },
          { key: "company", type: "text", label: "Company" },
          { key: "score", type: "number", label: "Lead Score" },
        ],
        tableId: testTableId,
      }),
    });

    assert(result.form?.id, "Form should have an ID");
    testFormId = result.form.id;
    testFormSlug = slug;
    console.log(`  ✓ Created form: ${testFormId} (slug: ${slug})`);
  });

  // ── Step 3: Verify Form is accessible ───────────────────────────────────

  it("should fetch form fields via public endpoint", async () => {
    const result = await apiCall<{ form: { name: string; fields: any[] } }>(
      `/public/forms/${orgId}/${testFormSlug}`
    );

    assert(result.form?.name === "E2E Test Form", "Form name should match");
    assert(result.form?.fields?.length === 4, "Form should have 4 fields");
    console.log(`  ✓ Form has ${result.form.fields.length} fields`);
  });

  // ── Step 4: Submit Form Data ────────────────────────────────────────────

  it("should submit form data via public endpoint", async () => {
    const submissionData = {
      name: "John Smith",
      email: "john.smith@example.com",
      company: "Acme Corp",
      score: "85",
    };

    const result = await apiCall<{ ok: boolean; submission: { id: string } }>(
      `/public/forms/${orgId}/${testFormSlug}`,
      {
        method: "POST",
        body: JSON.stringify(submissionData),
      }
    );

    assert(result.ok === true, "Submission should succeed");
    assert(result.submission?.id, "Submission should have an ID");
    console.log(`  ✓ Form submitted: ${result.submission.id}`);
  });

  // ── Step 5: Verify Table Row Created ────────────────────────────────────

  it("should have created a row in the connected table", async () => {
    const result = await apiCall<{ records: Array<{ id: string; data: Record<string, unknown> }> }>(
      `/tables/${testTableId}/records`
    );

    assert(result.records?.length >= 1, "Table should have at least 1 record");

    // Find our test record
    const testRecord = result.records.find(
      (r) => r.data?.email === "john.smith@example.com"
    );
    assert(testRecord, "Should find the submitted record");
    assert(testRecord?.data?.name === "John Smith", "Name should match");
    assert(testRecord?.data?.company === "Acme Corp", "Company should match");
    console.log(`  ✓ Table has ${result.records.length} records, test record found`);
  });

  // ── Step 6: Verify Form Submissions ─────────────────────────────────────

  it("should show the submission in form submissions", async () => {
    const result = await apiCall<{ submissions: Array<{ id: string; data: Record<string, unknown> }> }>(
      `/forms/${testFormId}/submissions`
    );

    assert(result.submissions?.length >= 1, "Form should have submissions");
    const sub = result.submissions.find(
      (s) => s.data?.email === "john.smith@example.com"
    );
    assert(sub, "Should find our submission");
    console.log(`  ✓ Form has ${result.submissions.length} submissions`);
  });

  // ── Step 7: Create a Workflow with Table Action ─────────────────────────

  it("should create a workflow that writes to the table", async () => {
    // Create a workflow
    const flowResult = await apiCall<{ flow: { id: string; name: string } }>("/flows", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Test Workflow",
        origin: "manual",
      }),
    });

    testWorkflowId = flowResult.flow.id;

    // Define the graph: trigger → table create_record
    const graph = {
      schemaVersion: 1,
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          appSlug: "forms",
          operation: "submitted",
          label: "Form Submission",
          position: { x: 280, y: 40 },
          config: {},
        },
        {
          id: "table_action",
          type: "action",
          appSlug: "tables",
          operation: "create_record",
          label: "Create Table Row",
          position: { x: 280, y: 200 },
          config: {
            tableId: testTableId,
            mappings: {
              name: "{{trigger.name}}",
              email: "{{trigger.email}}",
              company: "{{trigger.company}}",
              score: "{{trigger.score}}",
            },
          },
        },
      ],
      edges: [{ id: "e-trigger-table_action", source: "trigger", target: "table_action" }],
      settings: { timezone: "UTC" },
    };

    // Save the graph
    await apiCall(`/flows/${testWorkflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft_definition: graph }),
    });

    console.log(`  ✓ Created workflow: ${testWorkflowId}`);
  });

  // ── Step 8: Publish the Workflow ────────────────────────────────────────

  it("should publish the workflow", async () => {
    const result = await apiCall<{ ok: boolean; versionId: string }>(
      `/flows/${testWorkflowId}/publish`,
      { method: "POST" }
    );

    assert(result.ok === true, "Publish should succeed");
    assert(result.versionId, "Should have a version ID");
    console.log(`  ✓ Workflow published: v${result.versionId}`);
  });

  // ── Step 9: Trigger the Workflow Manually ───────────────────────────────

  it("should trigger the workflow manually", async () => {
    const result = await apiCall<{ execution: { id: string; status: string } }>(
      `/automations/${testWorkflowId}/run`,
      {
        method: "POST",
        body: JSON.stringify({
          payload: {
            name: "Jane Doe",
            email: "jane.doe@example.com",
            company: "TechCorp",
            score: "92",
          },
        }),
      }
    );

    assert(result.execution?.id, "Execution should have an ID");
    console.log(`  ✓ Workflow triggered: ${result.execution.id}`);
  });

  // ── Step 10: Verify the Table Row from Automation ───────────────────────

  it("should have created a second row in the table from automation", async () => {
    // Wait a moment for the worker to process
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const result = await apiCall<{ records: Array<{ id: string; data: Record<string, unknown> }> }>(
      `/tables/${testTableId}/records`
    );

    assert(result.records?.length >= 2, `Table should have at least 2 records (got ${result.records?.length})`);

    // Find the automation-created record
    const autoRecord = result.records.find(
      (r) => r.data?.email === "jane.doe@example.com"
    );
    assert(autoRecord, "Should find the automation-created record");
    assert(autoRecord?.data?.name === "Jane Doe", "Name should match");
    assert(autoRecord?.data?.company === "TechCorp", "Company should match");
    console.log(`  ✓ Table now has ${result.records.length} records (2 from test)`);
  });

  // ── Step 11: Verify Run History ─────────────────────────────────────────

  it("should show the run in execution history", async () => {
    const result = await apiCall<{ runs: Array<{ id: string; status: string; flow_name: string }> }>(
      "/runs"
    );

    assert(result.runs?.length >= 1, "Should have at least 1 run");
    console.log(`  ✓ Found ${result.runs.length} runs in history`);
  });
});

// ── Direct table adapter test ────────────────────────────────────────────────

describe("Table Adapter Direct Test", () => {
  it("should create a record via the tables adapter", async () => {
    // This tests the adapter layer directly
    const result = await apiCall<{ record: { id: string; data: Record<string, unknown> } }>(
      `/tables/${testTableId}/records`,
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            name: "Direct Adapter Test",
            email: "adapter@test.com",
            company: "Direct Corp",
            score: "75",
          },
        }),
      }
    );

    assert(result.record?.id, "Record should have an ID");
    assert(result.record?.data?.name === "Direct Adapter Test", "Name should match");
    console.log(`  ✓ Direct record created: ${result.record.id}`);
  });
});
