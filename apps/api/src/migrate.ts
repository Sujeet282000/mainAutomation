import fs from "fs";
import path from "path";
import { pool } from "./db";

async function main() {
  const dir = path.resolve(__dirname, "../../../supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await pool.query(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz default now())`);
  for (const file of files) {
    const done = await pool.query("select 1 from schema_migrations where id=$1", [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
    await pool.query("insert into schema_migrations (id) values ($1)", [file]);
    console.log("applied", file);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
