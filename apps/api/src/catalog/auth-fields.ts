import type { AuthField } from "../auth-schema";

/**
 * Per-app credential fields, modeled on Zapier's authentication setup screens:
 * exact fields the vendor requires, a placeholder, and a "where do I find
 * this" link to the vendor's developer console.
 */
const key = (label = "API key", helpUrl?: string, helpUrlLabel = "Where do I find this?"): AuthField => ({
  key: "api_key",
  label,
  type: "password",
  required: true,
  helpUrl,
  helpUrlLabel,
});

const bearer = (helpUrl?: string): AuthField => key("API key / token", helpUrl);

export const AUTH_FIELDS: Record<string, AuthField[]> = {
  // ── AI ────────────────────────────────────────────────────────────────────
  openai: [
    { key: "api_key", label: "API Key", type: "password", required: true, placeholder: "sk-...", help: "Keys start with sk-.", helpUrl: "https://platform.openai.com/api-keys", helpUrlLabel: "Create an API key" },
    { key: "organization_id", label: "Organization ID", type: "string", required: false, help: "Only if your account belongs to multiple organizations." },
  ],
  anthropic: [{ key: "api_key", label: "API Key", type: "password", required: true, placeholder: "sk-ant-...", helpUrl: "https://console.anthropic.com/settings/keys", helpUrlLabel: "Create an API key" }],
  gemini: [{ key: "api_key", label: "API Key", type: "password", required: true, helpUrl: "https://aistudio.google.com/apikey", helpUrlLabel: "Get an API key" }],
  groq: [{ key: "api_key", label: "API Key", type: "password", required: true, placeholder: "gsk_...", helpUrl: "https://console.groq.com/keys", helpUrlLabel: "Create an API key" }],
  huggingface: [{ key: "api_key", label: "Access token", type: "password", required: true, placeholder: "hf_...", helpUrl: "https://huggingface.co/settings/tokens", helpUrlLabel: "Create a token" }],
  cohere: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://dashboard.cohere.com/api-keys", helpUrlLabel: "Get an API key" }],
  replicate: [{ key: "api_key", label: "API token", type: "password", required: true, placeholder: "r8_...", helpUrl: "https://replicate.com/account/api-tokens", helpUrlLabel: "Find your token" }],
  elevenlabs: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://elevenlabs.io/app/settings/api-keys", helpUrlLabel: "Create an API key" }],

  // ── CRM ───────────────────────────────────────────────────────────────────
  close: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://app.close.com/settings/api/", helpUrlLabel: "Get your API key" }],
  freshsales: [
    { key: "domain", label: "Portal domain", type: "string", required: true, placeholder: "https://yourcompany.myfreshworks.com" },
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://developers.freshworks.com/crm/api/#authentication", helpUrlLabel: "Where do I find this?" },
  ],
  "follow-up-boss": [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://login.followupboss.com/settings/api", helpUrlLabel: "Get your API key" }],

  // ── Marketing / email ─────────────────────────────────────────────────────
  mailchimp: [
    { key: "api_key", label: "API key", type: "password", required: true, placeholder: "xxxxxxxx-us12", help: "Includes the datacenter suffix (e.g. us12).", helpUrl: "https://admin.mailchimp.com/account/api/", helpUrlLabel: "Create an API key" },
  ],
  sendgrid: [{ key: "api_key", label: "API key", type: "password", required: true, placeholder: "SG....", helpUrl: "https://app.sendgrid.com/settings/api_keys", helpUrlLabel: "Create an API key" }],
  activecampaign: [
    { key: "url", label: "API URL", type: "string", required: true, placeholder: "https://youraccount.api-us1.com", helpUrl: "https://youraccount.activehosted.com/app/settings/developer", helpUrlLabel: "Where do I find this?" },
    { key: "api_key", label: "API key", type: "password", required: true },
  ],
  klaviyo: [{ key: "api_key", label: "Private API key", type: "password", required: true, placeholder: "pk_...", helpUrl: "https://www.klaviyo.com/settings/api", helpUrlLabel: "Create a private key" }],
  brevo: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://app.brevo.com/settings/keys/api", helpUrlLabel: "Generate a key" }],
  convertkit: [{ key: "api_key", label: "API secret", type: "password", required: true, helpUrl: "https://app.convertkit.com/account_settings/developer_settings", helpUrlLabel: "Find your secret" }],
  mailerlite: [{ key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://dashboard.mailerlite.com/api", helpUrlLabel: "Generate a token" }],

  // ── Communication ─────────────────────────────────────────────────────────
  twilio: [
    { key: "account_sid", label: "Account SID", type: "string", required: true, placeholder: "AC...", helpUrl: "https://console.twilio.com/", helpUrlLabel: "Console" },
    { key: "auth_token", label: "Auth token", type: "password", required: true },
  ],
  discord: [{ key: "bot_token", label: "Bot token", type: "password", required: true, help: "From your application's Bot settings, not a user token.", helpUrl: "https://discord.com/developers/applications", helpUrlLabel: "Developer portal" }],
  telegram: [{ key: "api_key", label: "Bot token", type: "password", required: true, placeholder: "123456:ABC-DEF...", help: "Create a bot with @BotFather.", helpUrl: "https://t.me/BotFather", helpUrlLabel: "Open BotFather" }],
  mattermost: [
    { key: "site_url", label: "Site URL", type: "string", required: true, placeholder: "https://mattermost.yourcompany.com" },
    { key: "api_key", label: "Personal access token", type: "password", required: true, helpUrl: "https://docs.mattermost.com/integrations/personal-access-tokens.html", helpUrlLabel: "How to create one" },
  ],
  vonage: [
    { key: "api_key", label: "API key", type: "string", required: true, helpUrl: "https://dashboard.vonage.com/", helpUrlLabel: "Dashboard" },
    { key: "api_secret", label: "API secret", type: "password", required: true },
  ],
  messagebird: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://dashboard.messagebird.com/en/developers/access", helpUrlLabel: "Get your key" }],

  // ── Project management / docs ─────────────────────────────────────────────
  linear: [{ key: "api_key", label: "API key", type: "password", required: true, placeholder: "lin_api_...", helpUrl: "https://linear.app/settings/api", helpUrlLabel: "Create a personal API key" }],
  jira: [
    { key: "host", label: "Site URL", type: "string", required: true, placeholder: "https://your-domain.atlassian.net" },
    { key: "email", label: "Email", type: "string", required: true },
    { key: "api_token", label: "API token", type: "password", required: true, helpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens", helpUrlLabel: "Create an API token" },
  ],
  confluence: [
    { key: "host", label: "Site URL", type: "string", required: true, placeholder: "https://your-domain.atlassian.net/wiki" },
    { key: "email", label: "Email", type: "string", required: true },
    { key: "api_token", label: "API token", type: "password", required: true, helpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens", helpUrlLabel: "Create an API token" },
  ],
  airtable: [{ key: "api_key", label: "Personal access token", type: "password", required: true, placeholder: "pat...", helpUrl: "https://airtable.com/create/tokens", helpUrlLabel: "Create a token" }],
  trello: [
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://trello.com/app-key", helpUrlLabel: "Get your API key" },
    { key: "token", label: "Token", type: "password", required: true, help: "Click 'Token' on the same page after generating the API key." },
  ],
  coda: [{ key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://coda.io/account", helpUrlLabel: "Account settings" }],

  // ── Commerce / payments ───────────────────────────────────────────────────
  shopify: [
    { key: "shop", label: "Shop domain", type: "string", required: true, placeholder: "your-store.myshopify.com" },
    { key: "access_token", label: "Admin API access token", type: "password", required: true, help: "Create a custom app in Settings → Apps → Develop apps.", helpUrl: "https://help.shopify.com/en/manual/apps/custom-apps", helpUrlLabel: "Custom app guide" },
  ],
  woocommerce: [
    { key: "site_url", label: "Store URL", type: "string", required: true, placeholder: "https://yourstore.com" },
    { key: "consumer_key", label: "Consumer key", type: "string", required: true, helpUrl: "https://woocommerce.com/document/woocommerce-rest-api/", helpUrlLabel: "How to create keys" },
    { key: "consumer_secret", label: "Consumer secret", type: "password", required: true },
  ],
  bigcommerce: [
    { key: "store_hash", label: "Store hash", type: "string", required: true, placeholder: "abc123", help: "The part before .mybigcommerce.com." },
    { key: "access_token", label: "Access token", type: "password", required: true, helpUrl: "https://developer.bigcommerce.com/docs/start/authentication", helpUrlLabel: "Auth guide" },
  ],
  razorpay: [
    { key: "key_id", label: "Key ID", type: "string", required: true, helpUrl: "https://dashboard.razorpay.com/app/keys", helpUrlLabel: "API keys" },
    { key: "key_secret", label: "Key secret", type: "password", required: true },
  ],
  chargebee: [
    { key: "site", label: "Site", type: "string", required: true, placeholder: "yourcompany", help: "Your Chargebee site name (app.chargebee.com)." },
    { key: "api_key", label: "Full-access API key", type: "password", required: true, helpUrl: "https://app.chargebee.com/users/api_keys", helpUrlLabel: "API keys" },
  ],

  // ── Support ───────────────────────────────────────────────────────────────
  zendesk: [
    { key: "subdomain", label: "Subdomain", type: "string", required: true, placeholder: "yourcompany", help: "yourcompany.zendesk.com" },
    { key: "email", label: "Email", type: "string", required: true },
    { key: "api_token", label: "API token", type: "password", required: true, helpUrl: "https://yourcompany.zendesk.com/admin/apps-integrations/apis/apis/settings", helpUrlLabel: "Admin → API" },
  ],
  freshdesk: [
    { key: "domain", label: "Domain", type: "string", required: true, placeholder: "https://yourcompany.freshdesk.com" },
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://support.freshdesk.com/en/support/solutions/articles/50000001144", helpUrlLabel: "Where do I find this?" },
  ],
  gorgias: [
    { key: "domain", label: "Domain", type: "string", required: true, placeholder: "yourcompany.gorgias.com" },
    { key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://yourcompany.gorgias.com/app/settings/api", helpUrlLabel: "Settings → API" },
  ],
  crisp: [{ key: "website_id", label: "Website ID", type: "string", required: true, helpUrl: "https://app.crisp.chat/settings/websites/", helpUrlLabel: "Website settings" }, { key: "api_key", label: "API key (identifier:token)", type: "password", required: true, help: "Format: identifier:token from the Crisp Marketplace." }],

  // ── Forms ─────────────────────────────────────────────────────────────────
  jotform: [
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://www.jotform.com/myaccount/api", helpUrlLabel: "My Account → API" },
    { key: "region", label: "Region", type: "select", required: false, options: [{ label: "US (api.jotform.com)", value: "https://api.jotform.com" }, { label: "EU (eu-api.jotform.com)", value: "https://eu-api.jotform.com" }] },
  ],
  tally: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://tally.so/settings", helpUrlLabel: "Tally settings" }],

  // ── HR ────────────────────────────────────────────────────────────────────
  bamboohr: [
    { key: "subdomain", label: "Subdomain", type: "string", required: true, placeholder: "yourcompany" },
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://yourcompany.bamboohr.com/settings/api_keys", helpUrlLabel: "Add API key" },
  ],
  greenhouse: [{ key: "api_key", label: "Harvest API key", type: "password", required: true, helpUrl: "https://app.greenhouse.io/configure/dev_center/credentials", helpUrlLabel: "Dev center" }],
  workable: [{ key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://www.workable.com/backend/account/developers", helpUrlLabel: "Developers" }],

  // ── Databases (custom) ────────────────────────────────────────────────────
  postgresql: [
    { key: "host", label: "Host", type: "string", required: true, placeholder: "localhost" },
    { key: "port", label: "Port", type: "string", required: false, placeholder: "5432" },
    { key: "database", label: "Database", type: "string", required: true },
    { key: "username", label: "User", type: "string", required: true },
    { key: "password", label: "Password", type: "password", required: false },
    { key: "ssl", label: "SSL mode", type: "select", required: false, options: [{ label: "prefer", value: "prefer" }, { label: "require", value: "require" }, { label: "disable", value: "disable" }] },
  ],
  mysql: [
    { key: "host", label: "Host", type: "string", required: true },
    { key: "port", label: "Port", type: "string", required: false, placeholder: "3306" },
    { key: "database", label: "Database", type: "string", required: true },
    { key: "username", label: "User", type: "string", required: true },
    { key: "password", label: "Password", type: "password", required: false },
  ],
  mongodb: [{ key: "connection_string", label: "Connection string", type: "password", required: true, placeholder: "mongodb+srv://user:pass@cluster/...", helpUrl: "https://www.mongodb.com/docs/atlas/connection-strings/", helpUrlLabel: "Connection guide" }],
  supabase: [
    { key: "project_url", label: "Project URL", type: "string", required: true, placeholder: "https://xyz.supabase.co" },
    { key: "api_key", label: "Service role key", type: "password", required: true, helpUrl: "https://supabase.com/dashboard/project/_/settings/api", helpUrlLabel: "Project → API" },
  ],
  firebase: [{ key: "service_account_json", label: "Service account JSON", type: "password", required: true, help: "Paste the full private key file contents.", helpUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts", helpUrlLabel: "Service accounts" }],
  snowflake: [
    { key: "account", label: "Account", type: "string", required: true, placeholder: "xy12345.us-east-1" },
    { key: "username", label: "Username", type: "string", required: true },
    { key: "password", label: "Password", type: "password", required: true },
    { key: "warehouse", label: "Warehouse", type: "string", required: false },
  ],
  amazon_s3: [
    { key: "access_key_id", label: "Access key ID", type: "string", required: true, helpUrl: "https://console.aws.amazon.com/iam/", helpUrlLabel: "IAM console" },
    { key: "secret_access_key", label: "Secret access key", type: "password", required: true },
    { key: "region", label: "Region", type: "string", required: false, placeholder: "us-east-1" },
  ],
  auth0: [
    { key: "domain", label: "Domain", type: "string", required: true, placeholder: "yourcompany.us.auth0.com" },
    { key: "client_id", label: "Client ID", type: "string", required: true, helpUrl: "https://manage.auth0.com/#/applications", helpUrlLabel: "Applications" },
    { key: "client_secret", label: "Client secret", type: "password", required: true },
  ],
  odoo: [
    { key: "site_url", label: "Odoo URL", type: "string", required: true, placeholder: "https://yourcompany.odoo.com" },
    { key: "database", label: "Database name", type: "string", required: true },
    { key: "username", label: "Email", type: "string", required: true },
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://www.odoo.com/documentation/master/developers/webservices/odoo.html", helpUrlLabel: "API keys guide" },
  ],
  netsuite: [
    { key: "account", label: "Account ID", type: "string", required: true },
    { key: "consumer_key", label: "Consumer key", type: "string", required: true },
    { key: "consumer_secret", label: "Consumer secret", type: "password", required: true },
    { key: "token_id", label: "Token ID", type: "string", required: true },
    { key: "token_secret", label: "Token secret", type: "password", required: true },
  ],

  // ── Dev tools ─────────────────────────────────────────────────────────────
  gitlab: [{ key: "access_token", label: "Personal access token", type: "password", required: true, helpUrl: "https://gitlab.com/-/user_settings/personal_access_tokens", helpUrlLabel: "Create a token" }],
  bitbucket: [{ key: "api_key", label: "App password", type: "password", required: true, helpUrl: "https://bitbucket.org/account/settings/app-passwords/", helpUrlLabel: "App passwords" }, { key: "username", label: "Username", type: "string", required: true }],
  vercel: [{ key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://vercel.com/account/tokens", helpUrlLabel: "Create a token" }],
  netlify: [{ key: "api_key", label: "Personal access token", type: "password", required: true, helpUrl: "https://app.netlify.com/user/applications", helpUrlLabel: "Create a token" }],
  pagerduty: [{ key: "api_key", label: "API access key", type: "password", required: true, helpUrl: "https://app.pagerduty.com/settings/users/my_user/api_keys", helpUrlLabel: "API keys" }],
  sentry: [{ key: "api_key", label: "Auth token", type: "password", required: true, helpUrl: "https://sentry.io/settings/auth-tokens/", helpUrlLabel: "Create an auth token" }],
  datadog: [
    { key: "site_url", label: "Site", type: "select", required: false, options: [{ label: "datadoghq.com", value: "https://api.datadoghq.com" }, { label: "datadoghq.eu", value: "https://api.datadoghq.eu" }, { label: "us3.datadoghq.com", value: "https://api.us3.datadoghq.com" }] },
    { key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://app.datadoghq.com/organization-settings/api-keys", helpUrlLabel: "API keys" },
    { key: "application_key", label: "Application key", type: "password", required: true },
  ],

  // ── CMS ───────────────────────────────────────────────────────────────────
  wordpress: [
    { key: "site_url", label: "Site URL", type: "string", required: true, placeholder: "https://yourblog.com" },
    { key: "username", label: "Username", type: "string", required: true },
    { key: "api_key", label: "Application password", type: "password", required: true, helpUrl: "https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/", helpUrlLabel: "Application passwords" },
  ],
  contentful: [{ key: "api_key", label: "Content delivery API token", type: "password", required: true, helpUrl: "https://app.contentful.com/spaces/_/settings/api_keys", helpUrlLabel: "API keys" }, { key: "space_id", label: "Space ID", type: "string", required: true }],
  ghost: [{ key: "site_url", label: "Site URL", type: "string", required: true, placeholder: "https://blog.yourcompany.com" }, { key: "api_key", label: "Admin API key", type: "password", required: true, helpUrl: "https://ghost.org/integrations/custom-integrations/", helpUrlLabel: "Custom integrations" }],

  // ── Analytics ─────────────────────────────────────────────────────────────
  mixpanel: [{ key: "api_key", label: "Service account secret", type: "password", required: true, helpUrl: "https://mixpanel.com/settings/project/", helpUrlLabel: "Project settings" }, { key: "username", label: "Service account username", type: "string", required: false }],
  amplitude: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://analytics.amplitude.com/settings", helpUrlLabel: "Settings" }],
  segment: [{ key: "api_key", label: "Write key", type: "password", required: true, helpUrl: "https://app.segment.com/", helpUrlLabel: "Source settings" }],

  // ── Scheduling ────────────────────────────────────────────────────────────
  "cal-com": [{ key: "api_key", label: "API key", type: "password", required: true, placeholder: "cal_live_...", helpUrl: "https://app.cal.com/settings/developer", helpUrlLabel: "Developer settings" }],
  acuity: [{ key: "user_id", label: "User ID", type: "string", required: true, helpUrl: "https://acuityscheduling.com/settings/api", helpUrlLabel: "API settings" }, { key: "api_key", label: "API key", type: "password", required: true }],

  // ── Logistics / legal / education ─────────────────────────────────────────
  shipstation: [{ key: "api_key", label: "API key", type: "string", required: true, helpUrl: "https://www.shipstation.com/settings/api/", helpUrlLabel: "API settings" }, { key: "api_secret", label: "API secret", type: "password", required: true }],
  shippo: [{ key: "api_key", label: "API token", type: "password", required: true, placeholder: "shippo_live_...", helpUrl: "https://app.goshippo.com/settings/api", helpUrlLabel: "API settings" }],
  "dropbox-sign": [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://app.hellosign.com/home/myAccount/currentTab/api", helpUrlLabel: "API settings" }],
  teachable: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://developers.teachable.com/", helpUrlLabel: "Developer docs" }],
  thinkific: [{ key: "api_key", label: "API key", type: "password", required: true, helpUrl: "https://thinkific.com/dashboard#/settings/api", helpUrlLabel: "API settings" }],
  okta: [
    { key: "site_url", label: "Okta domain", type: "string", required: true, placeholder: "https://yourcompany.okta.com" },
    { key: "api_key", label: "API token", type: "password", required: true, helpUrl: "https://yourcompany.okta.com/settings/personal", helpUrlLabel: "Create a token" },
  ],

  // ── Utilities ────────────────────────────────────────────────────────────
  email: [{ key: "api_key", label: "SMTP/API credentials", type: "password", required: true, help: "Used by the built-in email sender when no provider is connected." }],
};
