-- The UI platform stores agents in workspace_items (kind='agent'); the
-- product surface also has the `agents` table. Activities/approvals must
-- reference both registries, so like agent_runs they carry a plain UUID.
ALTER TABLE public.agent_activities DROP CONSTRAINT IF EXISTS agent_activities_agent_id_fkey;
ALTER TABLE public.agent_approvals DROP CONSTRAINT IF EXISTS agent_approvals_agent_id_fkey;
