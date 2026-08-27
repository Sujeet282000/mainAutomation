import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async redirects() {
    return [
      { source: "/app", destination: "/dashboard", permanent: false },
      { source: "/app/automations", destination: "/automations", permanent: false },
      { source: "/app/automations/:id", destination: "/automations/:id/editor", permanent: false },
      { source: "/app/runs", destination: "/activity", permanent: false },
      { source: "/app/runs/:id", destination: "/activity/:id", permanent: false },
      { source: "/app/apps", destination: "/apps", permanent: false },
      { source: "/app/tables", destination: "/tables", permanent: false },
      { source: "/app/forms", destination: "/forms", permanent: false },
      { source: "/app/templates", destination: "/templates", permanent: false },
      { source: "/app/approvals", destination: "/approvals", permanent: false },
      { source: "/app/webhooks", destination: "/developer", permanent: false },
      { source: "/app/billing", destination: "/billing", permanent: false },
      { source: "/app/ai", destination: "/ai", permanent: false },
      { source: "/app/connections", destination: "/connections", permanent: false }
    ];
  }
};

export default nextConfig;
