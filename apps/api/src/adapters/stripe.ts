import { env } from "../config";
import { requireOk } from "./http";
import { registerAdapter } from "./registry";

function stripeKey(auth: Record<string, unknown> | null) {
  const key = String(auth?.api_key ?? env.stripe.secret);
  if (!key) throw new Error("Stripe secret key missing on the connection or STRIPE_SECRET_KEY (MANUAL).");
  return key;
}

registerAdapter("stripe", "new_payment", async ({ input }) => ({ output: input }));

registerAdapter("stripe", "create_customer", async ({ input, auth }) => {
  const body = new URLSearchParams({ email: String(input.email), name: String(input.name ?? "") });
  const res = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: { authorization: `Bearer ${stripeKey(auth)}` },
    body
  });
  return { output: await requireOk(res, "Stripe create customer") };
});
