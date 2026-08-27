"use client";

import { AppShell } from "@/features/shell/app-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
