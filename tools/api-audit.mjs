// One-off API surface audit: which endpoints the frontend calls vs. what exists.
import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd(), "..", "..");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name === "node_modules" || f.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\.|__tests__/.test(f.name)) out.push(p);
  }
  return out;
}

const norm = (p) => p
  .replace(/\/\$\{[^}]+\}/g, "/:param")
  .replace(/\/:[a-zA-Z]+/g, "/:param")
  .replace(/\?.*$/, "");

// Backend: (METHOD, /path) from route registrations
const beRoutes = new Set();
for (const file of walk(path.join(root, "apps", "api", "src"))) {
  const src = fs.readFileSync(file, "utf8");
  const re = /(?:authed|router|oauthRouter|webhookRouter|productsRouter|publicRouter|internal)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) beRoutes.add(`${m[1].toUpperCase()} ${norm(m[2])}`);
}

// Frontend: every path passed to api<T>(...), fetch(`${API_URL}...`), or SSE helpers
const feCalls = new Set();
for (const dir of ["app", "features", "lib"]) {
  for (const file of walk(path.join(root, "apps", "web", dir))) {
    const src = fs.readFileSync(file, "utf8");
    const re = /(?:api<[^>]*>\(\s*|fetch\(`\$\{API_URL\}|streamSse\(\s*|streamGetSse\(\s*)[`'"]?(\/[^`'"",\s)]*)/g;
    let m;
    while ((m = re.exec(src))) feCalls.add(norm(m[1]));
  }
}

const feMissing = [...feCalls].filter((c) => {
  const methodAgnostic = [...beRoutes].some((r) => r.endsWith(` ${c}`));
  return !methodAgnostic;
}).sort();

const beUncalled = [...beRoutes].filter((r) => {
  const p = r.split(" ")[1];
  if (/^\/(public|internal|v1|webhooks|oauth)\b/.test(p)) return false; // machine/special surfaces
  return ![...feCalls].some((c) => c === p);
}).sort();

console.log("=== FRONTEND CALLS WITH NO BACKEND ROUTE (breakage) ===");
console.log(feMissing.length ? feMissing.join("\n") : "(none — every FE call has a route)");
console.log(`\n=== BACKEND ENDPOINTS NOT CALLED BY THE WEB APP (${beUncalled.length}) ===`);
console.log(beUncalled.join("\n"));
