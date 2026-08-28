// =============================================================================
// Test Step Contracts — For testing individual workflow nodes against real providers
// =============================================================================

import { z } from "zod";

export const TestStepRequest = z.object({
  appSlug: z.string(),
  operation: z.string(),
  connectionId: z.string().uuid().optional(),
  config: z.record(z.unknown()).default({}),
  sampleInput: z.record(z.unknown()).optional(),
});
export type TestStepRequest = z.infer<typeof TestStepRequest>;

export const TestStepResult = z.object({
  ok: z.boolean(),
  appSlug: z.string(),
  operation: z.string(),
  executionTimeMs: z.number(),
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  errorType: z.enum([
    "none",
    "auth_error",
    "rate_limit",
    "timeout",
    "validation_error",
    "provider_error",
    "network_error",
    "unknown",
  ]).default("none"),
  sampleSaved: z.boolean().describe("Whether the output was saved as sample data"),
});
export type TestStepResult = z.infer<typeof TestStepResult>;
