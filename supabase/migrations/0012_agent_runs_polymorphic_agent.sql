-- Agent runs must support agents from both registries: the `agents` table and
-- `workspace_items` kind='agent'. A hard FK to `agents` breaks the UI surface.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_id_fkey;
