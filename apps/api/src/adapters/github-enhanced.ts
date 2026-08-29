import { authHeaders, requireOk } from "./http";
import { registerAdapter, registerDynamicFields } from "./registry";

const GITHUB_API = "https://api.github.com";

function ghHeaders(auth: Record<string, unknown> | null) {
  return {
    ...authHeaders(auth),
    "content-type": "application/json",
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

// ── Issues ──────────────────────────────────────────────────────────────

registerAdapter("github", "new_issue", async (ctx) => ({ output: ctx.input }));

registerAdapter("github", "create_issue", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  if (!repo.includes("/")) throw new Error("Repo must be in owner/repo format.");
  const body: Record<string, unknown> = { title: String(ctx.input.title ?? "Untitled issue") };
  if (ctx.input.body) body.body = String(ctx.input.body);
  if (ctx.input.labels) body.labels = String(ctx.input.labels).split(",").map((s: string) => s.trim());
  if (ctx.input.assignees) body.assignees = String(ctx.input.assignees).split(",").map((s: string) => s.trim());
  if (ctx.input.milestone) body.milestone = Number(ctx.input.milestone);

  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify(body),
  });
  return { output: await requireOk(res, "GitHub issue") };
});

registerAdapter("github", "update_issue", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  const issueNumber = Number(ctx.input.issueNumber);
  if (!repo.includes("/") || !issueNumber) throw new Error("Repo (owner/repo) and issueNumber required.");

  const body: Record<string, unknown> = {};
  if (ctx.input.title) body.title = String(ctx.input.title);
  if (ctx.input.body) body.body = String(ctx.input.body);
  if (ctx.input.state) body.state = String(ctx.input.state);
  if (ctx.input.labels) body.labels = String(ctx.input.labels).split(",").map((s: string) => s.trim());

  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify(body),
  });
  return { output: await requireOk(res, "GitHub issue update") };
});

registerAdapter("github", "close_issue", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  const issueNumber = Number(ctx.input.issueNumber);
  if (!repo.includes("/") || !issueNumber) throw new Error("Repo and issueNumber required.");

  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify({ state: "closed" }),
  });
  return { output: await requireOk(res, "GitHub close issue") };
});

// ── Pull Requests ───────────────────────────────────────────────────────

registerAdapter("github", "new_pr", async (ctx) => ({ output: ctx.input }));

registerAdapter("github", "create_pr", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  if (!repo.includes("/")) throw new Error("Repo must be in owner/repo format.");

  const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls`, {
    method: "POST",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify({
      title: String(ctx.input.title ?? "Untitled PR"),
      head: String(ctx.input.head ?? ""),
      base: String(ctx.input.base ?? "main"),
      body: String(ctx.input.body ?? ""),
    }),
  });
  return { output: await requireOk(res, "GitHub PR") };
});

registerAdapter("github", "merge_pr", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  const prNumber = Number(ctx.input.prNumber);
  if (!repo.includes("/") || !prNumber) throw new Error("Repo and prNumber required.");

  const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify({
      commit_title: String(ctx.input.title ?? ""),
      merge_method: String(ctx.input.mergeMethod ?? "squash"),
    }),
  });
  return { output: await requireOk(res, "GitHub merge PR") };
});

// ── Comments ────────────────────────────────────────────────────────────

registerAdapter("github", "add_comment", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  const issueNumber = Number(ctx.input.issueNumber);
  if (!repo.includes("/") || !issueNumber) throw new Error("Repo and issueNumber required.");

  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: ghHeaders(ctx.auth),
    body: JSON.stringify({ body: String(ctx.input.body ?? "") }),
  });
  return { output: await requireOk(res, "GitHub comment") };
});

// ── Repos ───────────────────────────────────────────────────────────────

registerAdapter("github", "list_repos", async (ctx) => {
  const url = new URL(`${GITHUB_API}/user/repos`);
  url.searchParams.set("per_page", String(Math.min(Number(ctx.input.limit ?? 30), 100)));
  url.searchParams.set("sort", String(ctx.input.sort ?? "updated"));
  url.searchParams.set("type", String(ctx.input.type ?? "owner"));

  const res = await fetch(url.toString(), { headers: ghHeaders(ctx.auth) });
  const body = await requireOk(res, "GitHub repos") as Record<string, unknown>;
  const repos = (body as unknown as Array<Record<string, unknown>>) ?? [];
  return {
    output: {
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        private: r.private,
        html_url: r.html_url,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
      })),
      total: repos.length,
    }
  };
});

registerAdapter("github", "get_repo", async (ctx) => {
  const repo = String(ctx.input.repo ?? "");
  if (!repo.includes("/")) throw new Error("Repo must be in owner/repo format.");
  const res = await fetch(`${GITHUB_API}/repos/${repo}`, { headers: ghHeaders(ctx.auth) });
  return { output: await requireOk(res, "GitHub repo") };
});

// ── Webhooks ────────────────────────────────────────────────────────────

registerAdapter("github", "push_event", async (ctx) => ({ output: ctx.input }));
registerAdapter("github", "pull_request_event", async (ctx) => ({ output: ctx.input }));
registerAdapter("github", "issues_event", async (ctx) => ({ output: ctx.input }));

// ── Dynamic Fields ──────────────────────────────────────────────────────

registerDynamicFields("github", async ({ auth, operation }) => {
  if (!auth) return [];

  const repoField = {
    key: "repo",
    label: "Repository",
    type: "select" as const,
    options: [] as Array<{ label: string; value: string; hint?: string }>,
  };

  // Fetch user's repos
  try {
    const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&sort=updated&type=owner`, {
      headers: ghHeaders(auth),
    });
    if (res.ok) {
      const repos = await res.json() as Array<{ full_name?: string; description?: string; default_branch?: string }>;
      repoField.options = repos.map((r) => ({
        label: r.full_name || "",
        value: r.full_name || "",
        hint: r.description ?? r.default_branch,
      })).filter((o) => o.value);
    }
  } catch { /* fallback to empty */ }

  const fields = [repoField];

  // For issue/PR operations, also fetch issues/PRs for update/merge
  if (["update_issue", "close_issue", "add_comment"].includes(operation)) {
    const repo = ""; // Will be filled by dynamic dependency
    if (repo) {
      try {
        const res = await fetch(`${GITHUB_API}/repos/${repo}/issues?state=open&per_page=50`, {
          headers: ghHeaders(auth),
        });
        if (res.ok) {
          const issues = await res.json() as Array<{ number?: number; title?: string; state?: string }>;
          fields.push({
            key: "issueNumber",
            label: "Issue",
            type: "select" as const,
            options: issues.map((i) => ({
              label: `#${i.number} ${i.title ?? ""}`.trim(),
              value: String(i.number),
              hint: i.state,
            })),
          });
        }
      } catch { /* fallback */ }
    }
  }

  if (["merge_pr"].includes(operation)) {
    const repo = "";
    if (repo) {
      try {
        const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls?state=open&per_page=50`, {
          headers: ghHeaders(auth),
        });
        if (res.ok) {
          const prs = await res.json() as Array<{ number?: number; title?: string }>;
          fields.push({
            key: "prNumber",
            label: "Pull Request",
            type: "select" as const,
            options: prs.map((p) => ({
              label: `#${p.number} ${p.title ?? ""}`.trim(),
              value: String(p.number),
            })),
          });
        }
      } catch { /* fallback */ }
    }
  }

  return fields;
});
