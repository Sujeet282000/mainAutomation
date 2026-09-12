#!/usr/bin/env node
// =============================================================================
// algoverge CLI — Piece SDK commands (P2 #29-31)
//
//   algoverge create-piece <name>   scaffold a new piece project
//   algoverge validate-piece       validate a piece definition (static checks)
//   algoverge test-piece            run the piece's declared self-checks
//   algoverge version-piece <semver> bump piece version + changelog entry
//   algoverge publish-piece         bundle the piece for registry upload
//
// A developer can build a complete piece without touching core engine code.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PUBLISHED_DIR = path.resolve(process.cwd(), ".algoverge/published");
const REGISTRY_ENDPOINT = process.env.ALGOVERGE_REGISTRY_URL ?? "https://registry.algoverge.dev/pieces";

function fail(message: string): never {
  console.error(`\u2717 ${message}`);
  process.exit(1);
}

function ok(message: string) {
  console.log(`\u2713 ${message}`);
}

// ── create-piece ────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const SCAFFOLD_PIECE = (name: string, cls: string) => `import { createPiece, createAction, createTrigger, Property } from "@algoverge/pieces-sdk";

export const ${cls} = createPiece({
  name: "${name}",
  displayName: "${name}",
  version: "0.1.0",
  categories: ["custom"],
  description: "TODO: describe your integration",
  auth: {
    type: "api_key",
    props: {
      api_key: Property.ShortText({ displayName: "API Key", required: true }),
    },
  },
  triggers: [
    createTrigger({
      name: "new_record",
      displayName: "New Record",
      description: "Fires when a new record is created",
      type: "polling",
      props: {},
      poll: async ({ cursor }) => ({ items: [], cursor: cursor ?? null }),
    }),
  ],
  actions: [
    createAction({
      name: "create_record",
      displayName: "Create Record",
      description: "Creates a record",
      sideEffect: "create",
      props: {
        data: Property.Json({ displayName: "Record Data", required: true }),
      },
      run: async ({ auth, propsValue, http, idempotencyKey }) => {
        return http.post("https://api.example.com/records", {
          headers: { authorization: \`Bearer \${auth}\` },
          body: { ...(propsValue.data as object), idempotencyKey },
        });
      },
    }),
  ],
});
`;

const SCAFFOLD_PACKAGE = (name: string) => `{
  "name": "${name}-piece",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "validate": "algoverge validate-piece",
    "test": "algoverge test-piece"
  },
  "dependencies": {
    "@algoverge/pieces-sdk": "*"
  },
  "devDependencies": {
    "tsx": "^4.19.3",
    "typescript": "^5.8.2"
  }
}
`;

const SCAFFOLD_MANIFEST = (name: string) => `# ${name}

Algoverge piece. See the Piece SDK docs for the full manifest contract.

- Auth: api_key (edit in src/index.ts)
- Triggers: polling
- Actions: create_record
`;

function cmdCreate(name: string | undefined) {
  if (!name) fail("create-piece requires a name: algoverge create-piece mycrm");
  const slug = slugify(name);
  if (!slug) fail("Name must contain letters or numbers");
  const dir = path.resolve(process.cwd(), slug);
  if (fs.existsSync(dir)) fail(`Directory already exists: ${dir}`);
  const cls = slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") + "Piece";
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.ts"), SCAFFOLD_PIECE(slug, cls));
  fs.writeFileSync(path.join(dir, "package.json"), SCAFFOLD_PACKAGE(slug));
  fs.writeFileSync(path.join(dir, "README.md"), SCAFFOLD_MANIFEST(name));
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\ndist\n.algoverge\n");
  ok(`Created piece ${slug} in ./${slug}`);
  console.log(`  Next: cd ${slug} && npm install && npx algoverge validate-piece`);
}

// ── piece loading + static validation ───────────────────────────────────────

type LoadedPiece = {
  name?: unknown; displayName?: unknown; version?: unknown; description?: unknown;
  auth?: { type?: unknown } & Record<string, unknown>;
  triggers?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
};

async function loadPieceFromCwd(): Promise<LoadedPiece> {
  const candidates = ["src/index.ts", "index.ts", "src/index.js", "dist/index.js"];
  for (const rel of candidates) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    if (rel.endsWith(".ts")) {
      // tsx registers the TS loader when the CLI itself runs under tsx.
      const mod = await import(pathToFileURL(p).href);
      const piece = mod.default ?? Object.values(mod).find((v: unknown) => (v as LoadedPiece)?.actions !== undefined);
      if (piece) return piece as LoadedPiece;
    } else {
      const mod = await import(pathToFileURL(p).href);
      return (mod.default ?? mod) as LoadedPiece;
    }
  }
  fail("No piece entrypoint found (expected src/index.ts exporting a createPiece result)");
}

async function cmdValidate() {
  const piece = await cmdValidateSyncLoad();
  const slug = String(piece.name ?? "");
  ok(`Piece ${slug}@${String(piece.version)} is valid`);
}

async function cmdValidateSyncLoad(): Promise<LoadedPiece> {
  // Static checks run without importing user code where possible.
  const pkgPath = path.resolve(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) fail("package.json not found — run inside a piece project");
  const srcPath = path.resolve(process.cwd(), "src/index.ts");
  const indexPath = path.resolve(process.cwd(), "index.ts");
  const entry = fs.existsSync(srcPath) ? srcPath : indexPath;
  if (!entry) fail("No piece entrypoint (src/index.ts or index.ts)");
  const source = fs.readFileSync(entry, "utf8");
  if (!/createPiece\s*\(/.test(source)) fail("Entrypoint must call createPiece(...)");
  if (!/actions\s*:/.test(source)) fail("Piece must declare at least one action");
  for (const banned of ["require('child_process')", "require(\"child_process\")", "process.env"]) {
    if (source.includes(banned)) fail(`Piece source must not use ${banned}`);
  }
  // Structural import check is done dynamically for full validation.
  return await loadPieceFromCwd();
}

// ── test-piece ──────────────────────────────────────────────────────────────

async function cmdTest() {
  const piece = await cmdValidateSyncLoad();
  const slug = String(piece.name ?? "piece");
  let failures = 0;

  // Every action must have run + displayName + sideEffect.
  for (const action of piece.actions ?? []) {
    const label = String(action.name ?? "<unnamed>");
    if (typeof action.run !== "function") { console.error(`\u2717 action ${label}: run() missing`); failures++; }
    if (!action.displayName) { console.error(`\u2717 action ${label}: displayName missing`); failures++; }
    if (!action.sideEffect) { console.error(`\u2717 action ${label}: sideEffect missing (read|create|update|delete)`); failures++; }
  }
  // Every trigger must declare either poll or onWebhook.
  for (const trigger of piece.triggers ?? []) {
    const label = String(trigger.name ?? "<unnamed>");
    if (trigger.type === "polling" && typeof trigger.poll !== "function") { console.error(`\u2717 trigger ${label}: poll() missing for polling trigger`); failures++; }
    if (trigger.type === "webhook" && typeof trigger.onWebhook !== "function") { console.error(`\u2717 trigger ${label}: onWebhook() missing for webhook trigger`); failures++; }
  }
  // Auth must have a type.
  if (!piece.auth || !piece.auth.type) { console.error("\u2717 auth.type missing"); failures++; }

  if (failures > 0) fail(`${failures} test failure(s) in ${slug}`);
  ok(`All self-checks passed for ${slug}`);
}

// ── version-piece ───────────────────────────────────────────────────────────

function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

function cmdVersion(next: string | undefined) {
  if (!next || !isValidSemver(next)) fail("version-piece requires a semver: algoverge version-piece 1.2.3");
  const pkgPath = path.resolve(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) fail("package.json not found");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const prev = String(pkg.version ?? "0.0.0");
  pkg.version = next;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // Keep the piece definition version in sync.
  const srcPath = path.resolve(process.cwd(), "src/index.ts");
  if (fs.existsSync(srcPath)) {
    const src = fs.readFileSync(srcPath, "utf8").replace(
      /version:\s*"(\d+\.\d+\.\d+[^"]*)"/,
      `version: "${next}"`
    );
    fs.writeFileSync(srcPath, src);
  }

  const changelog = path.resolve(process.cwd(), "CHANGELOG.md");
  const entry = `## ${next} - ${new Date().toISOString().slice(0, 10)}\n\n- Released ${prev} -> ${next}\n`;
  const updated = fs.existsSync(changelog)
    ? fs.readFileSync(changelog, "utf8").replace(/^# /, `# `) + `\n${entry}`
    : `# Changelog\n\n${entry}`;
  fs.writeFileSync(changelog, updated);
  ok(`Version bumped ${prev} -> ${next}`);
}

// ── publish-piece ───────────────────────────────────────────────────────────

async function cmdPublish() {
  const piece = await cmdValidateSyncLoad();
  const slug = String(piece.name ?? "piece");
  const version = String(piece.version ?? "0.0.0");
  fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
  const bundle = {
    name: slug,
    version,
    displayName: piece.displayName,
    description: piece.description,
    authType: piece.auth?.type,
    publishedAt: new Date().toISOString(),
    entry: "src/index.ts",
  };
  const out = path.join(PUBLISHED_DIR, `${slug}-${version}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  ok(`Bundled ${slug}@${version} -> ${out}`);
  console.log(`  Registry upload is a controlled platform operation.`);
  console.log(`  Set ALGOVERGE_REGISTRY_URL to publish to a private registry.`);
  void REGISTRY_ENDPOINT;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "create-piece": cmdCreate(arg); break;
    case "validate-piece": await cmdValidate(); break;
    case "test-piece": await cmdTest(); break;
    case "version-piece": cmdVersion(arg); break;
    case "publish-piece": await cmdPublish(); break;
    default:
      console.log(`algoverge — Piece SDK CLI

Usage:
  algoverge create-piece <name>    Scaffold a new piece project
  algoverge validate-piece         Validate the piece in the current directory
  algoverge test-piece             Run piece self-checks (actions/triggers/auth)
  algoverge version-piece <x.y.z>  Bump piece + package version, update changelog
  algoverge publish-piece          Bundle the piece for registry upload`);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
  }
}

void main();
