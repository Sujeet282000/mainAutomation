import { createAction, createPiece, createTrigger, Property } from "@algoverge/pieces-sdk";
import { z } from "zod";

type SlackAuth = { access_token: string; team?: { name?: string } };

export const sendMessage = createAction<SlackAuth>({
  name: "send_message",
  displayName: "Send Channel Message",
  description: "Post a message to a Slack channel.",
  aliases: ["notify slack", "post to slack", "alert team", "slack message"],
  sideEffect: "create",
  props: {
    channel: Property.Dropdown({
      displayName: "Channel",
      required: true,
      refreshers: ["auth"],
      aiHint: "Slack channel id or #name. Prefer a channel the user names in their prompt.",
      options: async ({ auth }) => {
        const a = auth as SlackAuth;
        const r = await fetch("https://slack.com/api/conversations.list?limit=1000", {
          headers: { Authorization: `Bearer ${a.access_token}` }
        });
        const j = (await r.json()) as { channels?: Array<{ name: string; id: string }> };
        return (j.channels ?? []).map((c) => ({ label: `#${c.name}`, value: c.id }));
      }
    }),
    text: Property.LongText({
      displayName: "Message",
      required: true,
      aiHint: "Supports {{step.field}} tokens and Slack mrkdwn."
    }),
    thread_ts: Property.ShortText({ displayName: "Thread timestamp", required: false })
  },
  outputSchema: z.object({ ok: z.boolean(), ts: z.string().optional(), channel: z.string().optional() }),
  async run({ auth, propsValue, http, idempotencyKey }) {
    return http.post("https://slack.com/api/chat.postMessage", {
      headers: { Authorization: `Bearer ${auth.access_token}`, "X-Idempotency-Key": idempotencyKey },
      body: {
        channel: propsValue.channel,
        text: propsValue.text,
        thread_ts: propsValue.thread_ts
      }
    });
  }
});

export const newMessage = createTrigger<SlackAuth>({
  name: "new_message",
  displayName: "New Message in Channel",
  description: "Fires when a message is posted to a channel.",
  aliases: ["slack message received", "when someone posts in slack"],
  type: "webhook",
  props: {
    channel: Property.Dropdown({ displayName: "Channel", required: true, refreshers: ["auth"] })
  },
  sampleOutput: { channel: "C123", user: "U456", text: "hello", ts: "1724500000.001" },
  async onEnable({ auth, webhookUrl, propsValue, store }) {
    const res = (await fetch("https://slack.com/api/apps.event.authorizations.subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, channel: propsValue.channel })
    }).then((r) => r.json())) as { subscription_id?: string };
    await store.put("external_hook_id", res.subscription_id);
  },
  async onDisable({ auth, store }) {
    const id = await store.get<string>("external_hook_id");
    if (!id) return;
    await fetch(`https://slack.com/api/subscriptions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.access_token}` }
    });
  },
  async onWebhook({ payload }) {
    const e = (payload as { event?: { subtype?: string } }).event;
    if (!e || e.subtype === "bot_message") return [];
    return [e];
  }
});

export const slackPiece = createPiece({
  name: "slack",
  displayName: "Slack",
  version: "1.0.0",
  categories: ["communication"],
  description: "Team messaging: send messages, create channels, react.",
  auth: {
    type: "oauth2",
    scopes: ["chat:write", "channels:read", "channels:manage"],
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access"
  },
  triggers: [newMessage],
  actions: [sendMessage]
});
