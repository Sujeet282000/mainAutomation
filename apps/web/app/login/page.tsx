"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import Link from "next/link";
import { api, setSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Logo } from "@/features/shell/logo";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export default function LoginPage() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "admin@algoverge.local", password: "ChangeMe123!" }
  });
  const [error, setError] = useState("");

  async function onSubmit(values: z.infer<typeof schema>) {
    setError("");
    try {
      const data = await api<{
        token: string;
        organization?: { id: string };
        workspace?: { id: string };
        workspaces?: Array<{ id: string }>;
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setSession(data.token, data.organization?.id ?? data.workspace?.id ?? data.workspaces?.[0]?.id);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password");
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
          src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1600&q=80"
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-10 text-white">
          <Logo />
          <div>
            <h2 className="text-3xl font-semibold">Ship automations with confidence.</h2>
            <p className="mt-2 max-w-sm text-sm text-white/70">Test every step. Watch the flow. Publish when it is ready.</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center bg-bg p-6">
        <Card className="w-full max-w-md">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h1 className="mt-2 text-xl font-semibold">Sign in</h1>
          <p className="mb-4 text-sm text-ink-muted">Welcome back to your workspace.</p>
          <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)}>
            <Input placeholder="Email" {...form.register("email")} />
            <Input type="password" placeholder="Password" {...form.register("password")} />
            {form.formState.errors.email && <p className="text-sm text-danger">{form.formState.errors.email.message}</p>}
            {error && <p className="text-sm text-danger">{error === "invalid_credentials" ? "Invalid email or password" : error}</p>}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Continue
            </Button>
            <Link href="/register" className="text-sm text-violet-700">
              Create an account
            </Link>
          </form>
        </Card>
      </div>
    </main>
  );
}
