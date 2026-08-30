-- Add conversation history storage for multi-turn copilot chat.
-- Each session accumulates an ordered list of {role, content} turns so the
-- LLM fallback can reference prior context during the same session.

ALTER TABLE public.copilot_sessions
  ADD COLUMN IF NOT EXISTS chat_history JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.copilot_sessions.chat_history
  IS 'Ordered array of {role: user|assistant, content: string, ts: string} turns for multi-turn LLM context.';
