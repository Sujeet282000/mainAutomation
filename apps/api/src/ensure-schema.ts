import { query } from "./db";

/** Idempotent tables the UI product surfaces need on top of the spec core schema. */
export async function ensureProductSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.workspace_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('agent','chatbot','canvas','interface')),
      name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_workspace_items_org_kind ON public.workspace_items (org_id, kind)`);
  await query(`
    CREATE TABLE IF NOT EXISTS public.oauth_states (
      state TEXT PRIMARY KEY,
      user_id UUID NOT NULL,
      org_id UUID NOT NULL,
      workspace_id UUID,
      app_slug TEXT NOT NULL,
      redirect_to TEXT,
      code_verifier TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS public.automation_folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}
