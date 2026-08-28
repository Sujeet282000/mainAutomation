// =============================================================================
// Forms — Data collection with builder, components, conditional logic, validation
// =============================================================================

import { z } from "zod";

// ─── Form Component Types ────────────────────────────────────────────────────

export const FormComponentType = z.enum([
  "text_input",
  "email_input",
  "number_input",
  "phone_input",
  "textarea",
  "select",
  "multi_select",
  "checkbox",
  "radio",
  "date",
  "datetime",
  "file_upload",
  "heading",
  "paragraph",
  "image",
  "html",
  "divider",
  "button",
  "table_embed",
  "iframe",
]);
export type FormComponentType = z.infer<typeof FormComponentType>;

// ─── Form Component ──────────────────────────────────────────────────────────

export const FormComponent = z.object({
  id: z.string().uuid(),
  type: FormComponentType,
  label: z.string().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
  // For select/radio/multi_select
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).default([]),
  // Conditional visibility
  conditions: z.array(z.object({
    fieldId: z.string(),
    operator: z.enum(["equals", "not_equals", "contains", "is_empty", "is_not_empty"]),
    value: z.unknown(),
  })).default([]),
  // Validation
  validation: z.object({
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    fileTypes: z.array(z.string()).optional(),
    maxFileSize: z.number().optional(),
  }).optional(),
  // Layout
  width: z.enum(["full", "half", "third"]).default("full"),
  position: z.number().int().default(0),
});
export type FormComponent = z.infer<typeof FormComponent>;

// ─── Form Page ───────────────────────────────────────────────────────────────

export const FormPage = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  components: z.array(FormComponent).default([]),
  position: z.number().int().default(0),
  // Page-level conditions
  conditions: z.array(z.object({
    fieldId: z.string(),
    operator: z.enum(["equals", "not_equals", "contains"]),
    value: z.unknown(),
  })).default([]),
});
export type FormPage = z.infer<typeof FormPage>;

// ─── Form ────────────────────────────────────────────────────────────────────

export const Form = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  pages: z.array(FormPage).default([]),
  // Settings
  settings: z.object({
    submitText: z.string().default("Submit"),
    successMessage: z.string().default("Thank you for your submission!"),
    redirectUrl: z.string().url().optional(),
    allowMultiple: z.boolean().default(false),
    requireAuth: z.boolean().default(false),
   截止Date: z.string().datetime().optional(),
    acceptanceMessage: z.string().optional(),
  }).default({}),
  // Integrations
  tableId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  // Sharing
  isPublic: z.boolean().default(false),
  publicUrl: z.string().url().optional(),
  embedCode: z.string().optional(),
  // Stats
  submissionCount: z.number().int().default(0),
  lastSubmissionAt: z.string().datetime().optional(),
  // Metadata
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Form = z.infer<typeof Form>;

// ─── Form Submission ─────────────────────────────────────────────────────────

export const FormSubmission = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
  recordId: z.string().uuid().optional(),
  workflowRunId: z.string().uuid().optional(),
  submittedBy: z.string().uuid().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type FormSubmission = z.infer<typeof FormSubmission>;
