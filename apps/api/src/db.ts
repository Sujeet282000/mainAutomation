import { Pool } from "pg";
import { env } from "./config";

export const pool = new Pool({ connectionString: env.databaseUrl, max: 20 });

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const res = await pool.query(text, params);
    return res.rows as T[];
  } catch (err) {
    console.error("DB query error:", (err as Error).message);
    throw err;
  }
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
