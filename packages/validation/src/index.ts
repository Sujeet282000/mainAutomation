import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  organization: z.string().optional()
});

export const automationCreateSchema = z.object({
  name: z.string().min(1),
  graph: z.unknown().optional()
});

export const connectionCreateSchema = z.object({
  appSlug: z.string().min(1),
  name: z.string().min(1),
  authType: z.string().optional(),
  credentials: z.record(z.unknown())
});
