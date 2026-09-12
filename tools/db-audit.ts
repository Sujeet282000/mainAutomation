import { pool } from "../apps/api/src/db";

async function main() {
  // 1. Duplicate indexes: same table + same column list, different names
  const idx = await pool.query(`
    SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename`);
  const byKey = new Map<string, string[]>();
  for (const row of idx.rows) {
    const def = String(row.indexdef).replace(/CREATE (UNIQUE )?INDEX \S+ ON /, "CREATE $1INDEX ON ");
    const list = def.match(/ON public\.([a-z_]+)/);
    if (!list) continue;
    const key = `${row.tablename}::${def.split(" USING ")[1] ?? ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), String(row.indexdef)]);
  }
  let dupCount = 0;
  for (const [, defs] of byKey) {
    if (defs.length > 1) {
      dupCount += defs.length - 1;
      console.log("DUPLICATE INDEXES:", defs.join("\n  "));
    }
  }
  console.log(`duplicate index defs: ${dupCount}`);

  // 2. Column overlap between org_id / workspace_id / organization_id (informational)
  const cols = await pool.query(`
    SELECT table_name, count(*) FILTER (WHERE column_name = 'org_id') AS has_org,
           count(*) FILTER (WHERE column_name = 'workspace_id') AS has_ws,
           count(*) FILTER (WHERE column_name = 'organization_id') AS has_orgid
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('org_id','workspace_id','organization_id')
    GROUP BY table_name
    HAVING count(*) > 1 ORDER BY table_name`);
  console.log(`\ntables carrying >1 of org_id/workspace_id/organization_id: ${cols.rowCount}`);
  for (const r of cols.rows.slice(0, 12)) console.log(" -", r.table_name, JSON.stringify(r));

  // 3. Unindexed foreign keys (top offenders)
  const unindexed = await pool.query(`
    SELECT c.conrelid::regclass AS tbl, c.conname,
           string_agg(a.attname, ',' ORDER BY a.attnum) AS cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
    GROUP BY c.conrelid, c.conname
    HAVING NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND (i.indkey::int2[] @> c.conkey::int2[])
    )
    ORDER BY c.conrelid::regclass::text LIMIT 20`);
  console.log(`\nunindexed FKs (first 20): ${unindexed.rowCount}`);
  for (const r of unindexed.rows) console.log(" -", r.tbl, r.conname, `(${r.cols})`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
