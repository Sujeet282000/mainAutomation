/**
 * Quick E2E Test: Form Submission → Table Row
 * 
 * Tests the core flow without workflow execution.
 * Run: npx tsx --test apps/api/src/__tests__/forms-tables-quick.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";

const API_URL = process.env.API_URL || "http://localhost:4000/api/v1";
const TEST_EMAIL = `quick-test-${Date.now()}@test.com`;
const TEST_PASSWORD = "TestPassword123!";

let authToken: string;
let orgId: string;
let testTableId: string;
let testFormId: string;
let testFormSlug: string;

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

describe("Form → Table E2E", () => {
  before(async () => {
    try {
      const reg = await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          name: "Quick Test User",
        }),
      });
      authToken = reg.token;
      orgId = reg.organization?.id || reg.workspace?.id;
    } catch {
      const login = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      });
      authToken = login.token;
      orgId = login.organization?.id || login.workspace?.id;
    }
    assert(authToken, "Should get auth token");
  });

  after(async () => {
    if (testFormId) await apiCall(`/forms/${testFormId}`, { method: "DELETE" }).catch(() => {});
    if (testTableId) await apiCall(`/tables/${testTableId}`, { method: "DELETE" }).catch(() => {});
  });

  it("1. Create table", async () => {
    const r = await apiCall<{ table: { id: string } }>("/tables", {
      method: "POST",
      body: JSON.stringify({
        name: "Quick Test Leads",
        schema: { fields: [
          { key: "name", type: "text", label: "Name" },
          { key: "email", type: "email", label: "Email" },
          { key: "company", type: "text", label: "Company" },
        ]},
      }),
    });
    testTableId = r.table.id;
    console.log(`  ✓ Table created: ${testTableId}`);
  });

  it("2. Create form connected to table", async () => {
    const slug = `qt-${Date.now()}`;
    const r = await apiCall<{ form: { id: string } }>("/forms", {
      method: "POST",
      body: JSON.stringify({
        name: "Quick Test Form",
        slug,
        fields: [
          { key: "name", type: "text", label: "Name" },
          { key: "email", type: "email", label: "Email" },
          { key: "company", type: "text", label: "Company" },
        ],
        tableId: testTableId,
      }),
    });
    testFormId = r.form.id;
    testFormSlug = slug;
    console.log(`  ✓ Form created: ${testFormId}`);
  });

  it("3. Fetch form via public endpoint", async () => {
    const r = await apiCall<{ form: { name: string; fields: any[] } }>(
      `/public/forms/${orgId}/${testFormSlug}`
    );
    assert(r.form.fields.length === 3, `Expected 3 fields, got ${r.form.fields.length}`);
    console.log(`  ✓ Form fetched: ${r.form.name} (${r.form.fields.length} fields)`);
  });

  it("4. Submit form via public endpoint", async () => {
    const r = await apiCall<{ ok: boolean; submission: { id: string } }>(
      `/public/forms/${orgId}/${testFormSlug}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Alice Johnson",
          email: "alice@example.com",
          company: "StartupXYZ",
        }),
      }
    );
    assert(r.ok, "Submission should succeed");
    console.log(`  ✓ Form submitted: ${r.submission.id}`);
  });

  it("5. Verify table row created", async () => {
    const r = await apiCall<{ records: Array<{ data: Record<string, unknown> }> }>(
      `/tables/${testTableId}/records`
    );
    const rec = r.records.find(x => x.data?.email === "alice@example.com");
    assert(rec, "Should find the submitted record in table");
    assert(rec.data.name === "Alice Johnson", "Name should match");
    console.log(`  ✓ Table has ${r.records.length} records, test record found`);
  });

  it("6. Direct table record creation via adapter endpoint", async () => {
    const r = await apiCall<{ record: { id: string; data: Record<string, unknown> } }>(
      `/tables/${testTableId}/records`,
      {
        method: "POST",
        body: JSON.stringify({
          data: { name: "Bob Smith", email: "bob@example.com", company: "BigCorp" },
        }),
      }
    );
    assert(r.record.id, "Record should have ID");
    assert(r.record.data.name === "Bob Smith", "Name should match");
    console.log(`  ✓ Direct record created: ${r.record.id}`);
  });

  it("7. Verify both records in table", async () => {
    const r = await apiCall<{ records: Array<{ data: Record<string, unknown> }> }>(
      `/tables/${testTableId}/records`
    );
    assert(r.records.length >= 2, `Expected >=2 records, got ${r.records.length}`);
    const emails = r.records.map(x => x.data?.email);
    assert(emails.includes("alice@example.com"), "Should have alice");
    assert(emails.includes("bob@example.com"), "Should have bob");
    console.log(`  ✓ Table has ${r.records.length} records (2 verified)`);
  });

  it("8. Form submissions endpoint returns data", async () => {
    const r = await apiCall<{ submissions: Array<{ data: Record<string, unknown> }> }>(
      `/forms/${testFormId}/submissions`
    );
    assert(r.submissions.length >= 1, "Should have at least 1 submission");
    console.log(`  ✓ Form has ${r.submissions.length} submissions`);
  });
});
