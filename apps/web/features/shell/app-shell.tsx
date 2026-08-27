"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, CreditCard, HelpCircle, Menu, Moon, PanelLeftClose, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { api, clearSession, getToken, getWorkspaceId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { NAV } from "./nav";

type Workspace = { id: string; name: string; slug?: string; role?: string; organization_name?: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const editor = path?.includes("/editor");

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{
        user: { email: string; full_name?: string };
        organization?: { id: string };
        workspaces: Workspace[];
      }>("/me"),
    enabled: Boolean(getToken())
  });

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const workspaces = me.data?.workspaces ?? [];
  const current = workspaces.find((w) => w.id === getWorkspaceId()) ?? workspaces[0];

  useEffect(() => {
    const orgId = me.data?.organization?.id ?? me.data?.workspaces?.[0]?.id;
    if (!orgId) return;
    const stored = getWorkspaceId();
    if (!stored || !workspaces.some((w) => w.id === stored)) {
      localStorage.setItem("workspaceId", orgId);
    }
  }, [me.data, workspaces]);

  function switchWs(id: string) {
    localStorage.setItem("workspaceId", id);
    setWsOpen(false);
    window.location.reload();
  }

  return (
    <div className={cn("flex min-h-0 bg-bg", editor ? "h-screen overflow-hidden" : "min-h-screen")}>
      <CommandPalette />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-elevated transition-all lg:static",
          editor || collapsed ? "w-[72px]" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex h-14 items-center justify-between px-3">
          <Logo compact={editor || collapsed} />
          {!editor && (
            <button className="hidden rounded-lg p-1 text-ink-muted hover:bg-muted lg:block" onClick={() => setCollapsed((v) => !v)}>
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((group) => (
            <div key={group.label} className="mb-4">
              {!collapsed && !editor && (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group.label}</div>
              )}
              {group.items.map((item) => {
                const active = path === item.href || (item.href !== "/dashboard" && path?.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={item.label}
                    className={cn(
                      "mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
                      active ? "bg-teal-soft text-teal" : "text-ink-muted hover:bg-muted hover:text-ink"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && !editor && item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-elevated/90 px-3 backdrop-blur">
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setMobileOpen((v) => !v)}>
            <Menu className="h-4 w-4" />
          </button>
          <button
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-sm"
            onClick={() => setWsOpen((v) => !v)}
          >
            <span className="max-w-[140px] truncate font-medium">{current?.name ?? "Workspace"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
          </button>
          {wsOpen && (
            <div className="absolute left-16 top-12 z-40 w-56 rounded-xl border border-line bg-elevated p-1 shadow-card">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => switchWs(w.id)}
                >
                  {w.name}
                  <div className="text-[11px] text-ink-muted">{w.organization_name ?? w.role}</div>
                </button>
              ))}
            </div>
          )}
          <button
            className="ml-2 hidden flex-1 items-center gap-2 rounded-lg border border-line bg-muted px-3 py-1.5 text-sm text-ink-muted md:flex"
            onClick={() => window.dispatchEvent(new Event("av:command"))}
          >
            <Search className="h-4 w-4" />
            Search
            <span className="ml-auto text-[10px]">⌘K</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notifications" className="rounded-lg p-2 text-ink-muted hover:bg-muted" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Link>
            <a href="https://github.com" className="rounded-lg p-2 text-ink-muted hover:bg-muted" aria-label="Help">
              <HelpCircle className="h-4 w-4" />
            </a>
            <Link href="/billing">
              <Button size="sm" variant="secondary">
                <CreditCard className="h-3.5 w-3.5" />
                Upgrade
              </Button>
            </Link>
            <button
              className="rounded-lg p-2 text-ink-muted hover:bg-muted"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </button>
            <button
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-teal text-xs font-semibold text-teal-fg"
              title={me.data?.user?.email}
              onClick={() => {
                clearSession();
                window.location.href = "/";
              }}
            >
              {(me.data?.user?.full_name ?? me.data?.user?.email ?? "U").slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main className={cn("flex min-h-0 flex-1 flex-col", editor ? "overflow-hidden p-0" : "p-5 lg:p-8")}>{children}</main>
      </div>
    </div>
  );
}
