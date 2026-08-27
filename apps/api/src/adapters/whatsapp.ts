import { env } from "../config";
import { requireOk } from "./http";
import { registerAdapter } from "./registry";

function creds(auth: Record<string, unknown> | null) {
  const token = String(auth?.api_key ?? auth?.access_token ?? env.meta.whatsappToken);
  const phone = String(auth?.phone_number_id ?? env.meta.phoneNumberId);
  if (!token || !phone) {
    throw new Error("WhatsApp credentials missing. Save a connection with api_key + phone_number_id, or set WHATSAPP_* env (MANUAL).");
  }
  return { token, phone };
}

registerAdapter("whatsapp", "inbound_message", async ({ input }) => ({ output: input }));

registerAdapter("whatsapp", "send_message", async ({ input, auth }) => {
  const { token, phone } = creds(auth);
  const res = await fetch(`https://graph.facebook.com/v21.0/${phone}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(input.to).replace(/\D/g, ""),
      type: "text",
      text: { body: input.text }
    })
  });
  return { output: await requireOk(res, "WhatsApp send") };
});

registerAdapter("whatsapp", "send_template", async ({ input, auth }) => {
  const { token, phone } = creds(auth);
  const res = await fetch(`https://graph.facebook.com/v21.0/${phone}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(input.to).replace(/\D/g, ""),
      type: "template",
      template: {
        name: input.template,
        language: { code: input.language ?? "en_US" }
      }
    })
  });
  return { output: await requireOk(res, "WhatsApp template") };
});
