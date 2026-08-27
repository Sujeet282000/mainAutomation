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
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  organization: z.string().optional()
});

export default function RegisterPage() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", organization: "" }
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
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          password: values.password,
          organization: values.organization || undefined
        })
      });
      setSession(data.token, data.organization?.id ?? data.workspace?.id ?? data.workspaces?.[0]?.id);
      window.location.href = "/dashboard";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the account";
      if (message === "email_taken") {
        setError("An account with this email already exists. Sign in instead.");
        return;
      }
      setError(message);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
          src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1600&q=80"
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-10 text-white">
          <Logo />
          <div>
            <h2 className="text-3xl font-semibold">Create a workspace in minutes.</h2>
            <p className="mt-2 max-w-sm text-sm text-white/70">
              Connect 50+ apps, let Copilot draft the Zap, then test each step before you publish.
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center bg-bg p-6">
        <Card className="w-full max-w-md">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h1 className="mt-2 text-xl font-semibold">Create your workspace</h1>
          <p className="mb-4 text-sm text-ink-muted">Free plan. No credit card.</p>
          <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)}>
            <Input placeholder="Your name" {...form.register("name")} />
            {form.formState.errors.name && <p className="text-sm text-danger">{form.formState.errors.name.message}</p>}
            <Input placeholder="Work email" {...form.register("email")} />
            {form.formState.errors.email && <p className="text-sm text-danger">{form.formState.errors.email.message}</p>}
            <Input type="password" placeholder="Password (8+ characters)" {...form.register("password")} />
            {form.formState.errors.password && (
              <p className="text-sm text-danger">{form.formState.errors.password.message}</p>
            )}
            <Input placeholder="Workspace name (optional)" {...form.register("organization")} />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create workspace
            </Button>
            <Link href="/login" className="text-sm text-violet-700">
              Already have an account? Sign in
            </Link>
          </form>
        </Card>
      </div>
    </main>
  );
}
