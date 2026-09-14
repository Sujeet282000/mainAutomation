-- Chatbots: single source of truth. Chatbot CRUD moves from the legacy
-- workspace_items store to the canonical chatbots table (chatbot_messages
-- already FKs chatbots(id), so every test message 500'd until now). These
-- columns back the chatbot settings surface (model picker, welcome message,
-- theming, on/off switch) that previously lived in workspace_items.payload.
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS welcome_message TEXT;
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS theme JSONB;
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.chatbots
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_chatbots_org_slug
  ON public.chatbots (org_id, slug);
