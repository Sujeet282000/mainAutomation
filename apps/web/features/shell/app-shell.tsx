"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, CreditCard, HelpCircle, Menu, Moon, PanelLeftClose, Search, Sun } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { api, clearSession, getToken, getWorkspaceId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { NAV } from "./nav";

type Workspace = { id: string; name: string; slug?: string; role?: string; organization_name?: string };

/* ── Collapsible Nav Group ────────────────────────────────────────────── */

function NavGroup({ group, path, collapsed, editor, onNavigate }: {
  group: (typeof NAV)[number];
  path: string;
  collapsed: boolean;
  editor: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(group.defaultOpen ?? false);
  const isActive = group.items.some((item) => path === item.href || (item.href !== "/dashboard" && path?.startsWith(item.href)));

  // Auto-open if a child is active
  useEffect(() => {
    if (isActive && !open) setOpen(true);
  }, [isActive]);

  if (collapsed || editor) {
    return (
      <div className="mb-3">
        {group.items.map((item) => {
          const active = path === item.href || (item.href !== "/dashboard" && path?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} title={item.label}
              className={cn("mb-0.5 flex items-center justify-center rounded-lg px-2 py-2.5 transition-colors",
                active ? "bg-teal-soft text-teal" : "text-ink-muted hover:bg-muted hover:text-ink"
              )}>
              <Icon className="h-[18px] w-[18px]" />
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative mb-0.5">
      {/* Group header / toggle */}
      <button
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all duration-200 relative z-10",
          isActive
            ? "text-ink bg-muted/30"
            : "text-ink-muted hover:bg-muted/50 hover:text-ink"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors duration-200",
          isActive ? "bg-teal text-white" : "bg-muted text-ink-muted"
        )}>
          {group.label.charAt(0)}
        </span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-ink-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Submenu — uses CSS grid for smooth open/close */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <div className="overflow-hidden">
          <div className="relative pl-2.5 pt-0.5 pb-1">
            {/* Vertical connector line */}
            <div className="absolute left-[18px] top-1 bottom-1 w-px bg-line/50" />

            {group.items.map((item) => {
              const active = path === item.href || (item.href !== "/dashboard" && path?.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group/item relative mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm transition-all duration-150",
                    active
                      ? "bg-teal-soft font-medium text-teal shadow-sm"
                      : "text-ink-muted hover:bg-muted hover:text-ink"
                  )}
                >
                  {/* Horizontal connector tick */}
                  <div className={cn(
                    "absolute -left-0 top-1/2 h-px w-2.5 -translate-y-1/2 transition-colors duration-150",
                    active ? "bg-teal" : "bg-line/60 group-hover/item:bg-ink-muted"
                  )} />
                  <Icon className={cn(
                    "h-4 w-4 shrink-0 transition-colors duration-150",
                    active ? "text-teal" : "text-ink-muted group-hover/item:text-ink"
                  )} />
                  <span className="truncate">{item.label}</span>
                  {active && (
                    <div className="ml-auto h-1.5 w-1.5 rounded-full bg-teal" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── App Shell ───────────────────────────────────────────────────────── */

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

  const handleNavigate = useCallback(() => setMobileOpen(false), []);

  return (
    <div className={cn("flex min-h-0 bg-bg", editor ? "h-screen overflow-hidden" : "min-h-screen")}>
      <CommandPalette />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-ink/30 backdrop-blur-sm lg:hidden" onClick={handleNavigate} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-line bg-elevated transition-all duration-300 ease-in-out lg:static",
          editor || collapsed ? "w-[72px]" : "w-[232px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line/50 px-3">
          <Logo compact={editor || collapsed} />
          {!editor && (
            <button
              className="hidden rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-muted hover:text-ink lg:block"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeftClose className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 py-3">
          {NAV.map((group) => (
            <NavGroup
              key={group.label}
              group={group}
              path={path ?? ""}
              collapsed={collapsed}
              editor={editor}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && !editor && (
          <div className="shrink-0 border-t border-line/50 px-3 py-3">
            <div className="flex items-center gap-2 text-[11px] text-ink-muted">
              <div className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
              <span>All systems operational</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-elevated/90 px-3 backdrop-blur">
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setMobileOpen((v) => !v)}>
            <Menu className="h-4 w-4" />
          </button>
          <button
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-sm transition-colors hover:bg-muted"
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
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={() => switchWs(w.id)}
                >
                  {w.name}
                  <div className="text-[11px] text-ink-muted">{w.organization_name ?? w.role}</div>
                </button>
              ))}
            </div>
          )}
          <button
            className="ml-2 hidden flex-1 items-center gap-2 rounded-lg border border-line bg-muted px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-muted/80 md:flex"
            onClick={() => window.dispatchEvent(new Event("av:command"))}
          >
            <Search className="h-4 w-4" />
            Search
            <span className="ml-auto rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">⌘K</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notifications" className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-muted" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Link>
            <a href="https://github.com" className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-muted" aria-label="Help">
              <HelpCircle className="h-4 w-4" />
            </a>
            <Link href="/billing">
              <Button size="sm" variant="secondary">
                <CreditCard className="h-3.5 w-3.5" />
                Upgrade
              </Button>
            </Link>
            <button
              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-muted"
              onClick={() => {
                // Add transition class for smooth theme switch
                document.documentElement.classList.add('theme-transitioning');
                setTheme(theme === "dark" ? "light" : "dark");
                // Remove transition class after animation completes
                setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 400);
              }}
              aria-label="Toggle theme"
            >
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </button>
            <button
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-teal text-xs font-semibold text-teal-fg transition-transform hover:scale-105"
              title={me.data?.user?.email}
              onClick={() => { clearSession(); window.location.href = "/"; }}
            >
              {(me.data?.user?.full_name ?? me.data?.user?.email ?? "U").slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className={cn("flex min-h-0 flex-1 flex-col", editor ? "overflow-hidden p-0" : "p-5 lg:p-8")}>
          {children}
        </main>
      </div>
    </div>
  );
}
