/**
 * OAuth2 provider registry — Zapier-style "Connect with <App>" authorization.
 *
 * Each provider declares its authorization endpoint, token endpoint, scopes
 * and quirks. The generic /oauth/:provider/start and /oauth/:provider/callback
 * routes in oauth.ts drive the flow from this table, so adding a provider is
 * data, not code.
 *
 * Client credentials come from env: <PROVIDER>_CLIENT_ID / <PROVIDER>_CLIENT_SECRET
 * via env.oauthProviders(). A provider without configured credentials falls back
 * to a secure token-paste connection with an explanatory note in the modal.
 */

export type OAuthProviderConfig = {
  /** env key prefix, e.g. NOTION → NOTION_CLIENT_ID / NOTION_CLIENT_SECRET */
  envKey: string;
  /** Catalog slugs authorized through this provider. */
  appSlugs: string[];
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra auth request params (e.g. access_type offline, prompt consent). */
  authParams?: Record<string, string>;
  /** true when the provider uses the `state` param only (no PKCE). */
  clientAuth: "body" | "basic";
  /** Send PKCE code_challenge (S256) on authorize + code_verifier on exchange. */
  pkce?: boolean;
  /** True when the provider can issue refresh tokens usable by us. */
  refreshable?: boolean;
  /** Default redirect env var name; provider-specific override. */
  redirectEnvKey?: string;
  /** Where to send the access token on API calls from adapters. */
  tokenStyle: "bearer" | "custom-header";
  customHeaderName?: string;
  docsUrl: string;
};

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  notion: {
    envKey: "NOTION",
    appSlugs: ["notion"],
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientAuth: "basic", // Notion requires Basic auth on token exchange
    tokenStyle: "bearer",
    docsUrl: "https://developers.notion.com/docs/getting-started",
  },
  salesforce: {
    envKey: "SALESFORCE",
    appSlugs: ["salesforce"],
    authUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token", "offline_access"],
    clientAuth: "body",
    refreshable: true,
    tokenStyle: "bearer",
    docsUrl: "https://developer.salesforce.com/docs/document.atlas.en-us.api_rest.meta/api_rest/intro_defining_remote_access_apps.htm",
  },
  hubspot: {
    envKey: "HUBSPOT",
    appSlugs: ["hubspot"],
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.companies.read", "crm.objects.deals.read", "crm.objects.deals.write"],
    clientAuth: "body",
    refreshable: true,
    tokenStyle: "bearer",
    docsUrl: "https://developers.hubspot.com/docs/api/working-with-oauth",
  },
  github: {
    envKey: "GITHUB",
    appSlugs: ["github"],
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org", "workflow"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
  },
  linear: {
    envKey: "LINEAR",
    appSlugs: ["linear"],
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.linear.app/docs/oauth/authentication",
  },
  airtable_oauth: {
    envKey: "AIRTABLE",
    appSlugs: ["airtable"],
    authUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    scopes: ["data.records:read", "data.records:write", "schema.bases:read"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://airtable.com/developers/web/api/introduction",
  },
  asana: {
    envKey: "ASANA",
    appSlugs: ["asana"],
    authUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    scopes: [], // Asana: scopes via app settings
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.asana.com/docs/oauth",
  },
  clickup: {
    envKey: "CLICKUP",
    appSlugs: ["clickup"],
    authUrl: "https://app.clickup.com/api",
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
    scopes: [],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developer.clickup.com/reference/authentication",
  },
  monday: {
    envKey: "MONDAY",
    appSlugs: ["monday"],
    authUrl: "https://auth.monday.com/oauth2/authorize",
    tokenUrl: "https://auth.monday.com/oauth2/token",
    scopes: ["boards:read", "boards:write", "workspaces:read"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developer.monday.com/api-docs/authentication",
  },
  zoom: {
    envKey: "ZOOM",
    appSlugs: ["zoom"],
    authUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    scopes: ["meeting:write", "meeting:read", "user:read"],
    clientAuth: "basic",
    refreshable: true,
    tokenStyle: "bearer",
    docsUrl: "https://developers.zoom.us/docs/integrations/oauth/",
  },
  dropbox: {
    envKey: "DROPBOX",
    appSlugs: ["dropbox"],
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["files.metadata.read", "files.content.read", "files.content.write"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.dropbox.com/oauth-guide",
  },
  box: {
    envKey: "BOX",
    appSlugs: ["box"],
    authUrl: "https://account.box.com/api/oauth2/authorize",
    tokenUrl: "https://api.box.com/oauth2/token",
    scopes: ["root_readwrite", "manage_app_users"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developer.box.com/guides/authentication/oauth2/",
  },
  pipedrive: {
    envKey: "PIPEDRIVE",
    appSlugs: ["pipedrive"],
    authUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    scopes: ["base"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://pipedrive.readme.io/docs/marketplace-oauth-authorization",
  },
  intercom: {
    envKey: "INTERCOM",
    appSlugs: ["intercom"],
    authUrl: "https://app.intercom.io/oauth",
    tokenUrl: "https://api.intercom.io/auth/eagle/token",
    scopes: [],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.intercom.com/docs/rest-apis/authentication",
  },
  calendly: {
    envKey: "CALENDLY",
    appSlugs: ["calendly"],
    authUrl: "https://auth.calendly.com/oauth/authorize",
    tokenUrl: "https://auth.calendly.com/oauth/token",
    scopes: ["default"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developer.calendly.com/api-docs/authENTICATE.md",
  },
  mailchimp: {
    envKey: "MAILCHIMP",
    appSlugs: ["mailchimp"],
    authUrl: "https://login.mailchimp.com/oauth2/authorize",
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
    scopes: [],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://mailchimp.com/developer/marketing/guides/access-user-data-oauth/",
  },
  typeform: {
    envKey: "TYPEFORM",
    appSlugs: ["typeform"],
    authUrl: "https://api.typeform.com/oauth/authorize",
    tokenUrl: "https://api.typeform.com/oauth/token",
    scopes: ["forms:read", "responses:read", "webhooks:write"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://www.typeform.com/developers/get-started/",
  },
  todoist: {
    envKey: "TODOIST",
    appSlugs: ["todoist"],
    authUrl: "https://todoist.com/oauth/authorize",
    tokenUrl: "https://todoist.com/oauth/access_token",
    scopes: ["data:read_write"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developer.todoist.com/guides/oauth/",
  },
  xero: {
    envKey: "XERO",
    appSlugs: ["xero"],
    authUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["openid", "profile", "email", "accounting.transactions", "accounting.contacts"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://developer.xero.com/documentation/guides/oauth2/authentication",
  },
  webflow: {
    envKey: "WEBFLOW",
    appSlugs: ["webflow"],
    authUrl: "https://webflow.com/oauth/authorize",
    tokenUrl: "https://api.webflow.com/oauth/access_token",
    scopes: ["cms:read", "cms:write"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.webflow.com/data/docs/getting-started-with-oauth",
  },
  docusign: {
    envKey: "DOCUSIGN",
    appSlugs: ["docusign"],
    authUrl: "https://account.docusign.com/oauth/auth",
    tokenUrl: "https://account.docusign.com/oauth/token",
    scopes: ["signature", "impersonation"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://developers.docusign.com/platform/auth/authcode/",
  },
  x_twitter: {
    envKey: "TWITTER",
    appSlugs: ["twitter", "x-twitter"],
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    clientAuth: "basic",
    pkce: true, // X (Twitter) OAuth2 requires PKCE
    refreshable: true,
    tokenStyle: "bearer",
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-2-0/user-access-token",
  },
  reddit: {
    envKey: "REDDIT",
    appSlugs: ["reddit"],
    authUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    scopes: ["identity", "submit", "read"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://www.reddit.com/dev/api/oauth",
  },
  spotify: {
    envKey: "SPOTIFY",
    appSlugs: ["spotify"],
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes: ["user-library-read", "playlist-modify-private", "playlist-modify-public"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://developer.spotify.com/documentation/web-api/tutorials/code-flow",
  },
  paypal: {
    envKey: "PAYPAL",
    appSlugs: ["paypal"],
    authUrl: "https://www.paypal.com/signin/authorize",
    tokenUrl: "https://api-m.paypal.com/v1/oauth2/token",
    scopes: ["https://uri.paypal.com/services/paypalops"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://developer.paypal.com/api/rest/authentication/",
  },
  quickbooks: {
    envKey: "QUICKBOOKS",
    appSlugs: ["quickbooks"],
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    clientAuth: "basic",
    tokenStyle: "bearer",
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization",
  },
  outlook: {
    envKey: "OUTLOOK",
    appSlugs: ["outlook"],
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Mail.Read", "Mail.Send", "offline_access", "User.Read"],
    authParams: { response_mode: "query" },
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://learn.microsoft.com/en-us/office/office-365-management/office-365-management-apis-overview",
  },
  ms_teams: {
    envKey: "TEAMS",
    appSlugs: ["ms-teams", "microsoft-teams"],
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["ChannelMessage.Send", "TeamsTab.ReadWriteForTeam.All", "offline_access", "User.Read"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/tokens-and-authentication",
  },
  youtube: {
    envKey: "YOUTUBE",
    appSlugs: ["youtube"],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtubepartner"],
    authParams: { access_type: "offline", prompt: "consent" },
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.google.com/youtube/v3/guides/auth/installed-apps",
  },
  linkedin: {
    envKey: "LINKEDIN",
    appSlugs: ["linkedin"],
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "email", "w_member_social"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
  },
  facebook_pages: {
    envKey: "FACEBOOK",
    appSlugs: ["facebook-pages"],
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow",
  },
  instagram: {
    envKey: "INSTAGRAM",
    appSlugs: ["instagram"],
    authUrl: "https://api.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    clientAuth: "body",
    tokenStyle: "bearer",
    docsUrl: "https://developers.facebook.com/docs/instagram-api/getting-started",
  },
};

/** Provider + appSlug pairs this registry can authorize. */
export function oauthProviderForApp(slug: string): { provider: string; config: OAuthProviderConfig } | null {
  for (const [provider, config] of Object.entries(OAUTH_PROVIDERS)) {
    if (config.appSlugs.includes(slug)) return { provider, config };
  }
  return null;
}

/** Is this OAuth provider fully configured (client id + secret in env)? */
export function oauthProviderReady(provider: string): boolean {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return false;
  return Boolean(process.env[`${config.envKey}_CLIENT_ID`] && process.env[`${config.envKey}_CLIENT_SECRET`]);
}

/** All app slugs the generic OAuth flow can currently authorize. */
export function oauthReadyAppSlugs(): string[] {
  const out: string[] = [];
  for (const [provider, config] of Object.entries(OAUTH_PROVIDERS)) {
    if (oauthProviderReady(provider)) out.push(...config.appSlugs);
  }
  return out;
}
