"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Dashboard", "/app"],
  ["Automations", "/app/automations"],
  ["Runs", "/app/runs"],
  ["Apps", "/app/apps"],
  ["Tables", "/app/tables"],
  ["Forms", "/app/forms"],
  ["Templates", "/app/templates"],
  ["Approvals", "/app/approvals"],
  ["Webhooks", "/app/webhooks"],
  ["Billing", "/app/billing"],
  ["Settings", "/app/settings"]
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r border-line bg-[#0d1326] p-5">
        <h3 className="mb-4 text-lg font-semibold">Algoverge</h3>
        <button
          className="mb-4 text-left text-xs text-muted"
          onClick={() => {
            localStorage.removeItem("token");
            localStorage.removeItem("workspaceId");
            window.location.href = "/";
          }}
        >
          Sign out
        </button>
        {links.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            className={`mb-1 block rounded-lg px-3 py-2 text-sm ${path === href ? "bg-[#1a2342] text-white" : "text-muted hover:bg-white/5"}`}
          >
            {label}
          </Link>
        ))}
      </aside>
      <div className="p-7">{children}</div>
    </div>
  );
}
