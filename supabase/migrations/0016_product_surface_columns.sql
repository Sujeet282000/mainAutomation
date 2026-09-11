-- Align product-surface tables with modules/products.ts queries.
-- Migration 0004 created chatbots/canvases/interfaces without workspace_id,
-- is_public (chatbots), theme (interfaces) or source_automation_id (canvases);
-- the product-surface fallback handlers (PATCH /chatbots/:id, PATCH
-- /interfaces/:id, canvas source lookup) select and filter on those columns,
-- so any request reaching them would 500. Also creates chatbot_messages,
-- which the chatbot chat handler persists to.

ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.canvases
  ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.canvases
  ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.canvases
  ADD COLUMN IF NOT EXISTS source_automation_id UUID;

ALTER TABLE public.interfaces
  ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.interfaces
  ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.interfaces
  ADD COLUMN IF NOT EXISTS theme JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id          BIGSERIAL PRIMARY KEY,
  chatbot_id  UUID NOT NULL REFERENCES public.chatbots(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_bot
  ON public.chatbot_messages (chatbot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chatbots_workspace
  ON public.chatbots (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvases_workspace
  ON public.canvases (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interfaces_workspace
  ON public.interfaces (workspace_id, created_at DESC);
