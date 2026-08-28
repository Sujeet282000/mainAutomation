"use client";

import { useState } from "react";
import { Bot, Zap, Link2, Calculator, Play, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** ── Field type definitions ─────────────────────────────────────────────── */

export type TableField = {
  key: string;
  type: string;
  label?: string;
  required?: boolean;
  /** For formula fields: expression like `col_a + col_b` or `price * quantity` */
  formula?: string;
  /** For AI fields: prompt template with {column} references */
  aiPrompt?: string;
  /** For button fields: the workflow automation ID to trigger */
  workflowId?: string;
  /** For button fields: label on the button */
  buttonLabel?: string;
  /** For linked fields: the table ID to link to */
  linkedTableId?: string;
  /** For linked fields: which field from the linked table to display */
  linkedField?: string;
  /** For select fields: dropdown options */
  options?: string[];
};

export type TableRecord = {
  id: string;
  data: Record<string, unknown>;
};

/** ── Formula evaluator ──────────────────────────────────────────────────── */

function evaluateFormula(
  formula: string,
  record: Record<string, unknown>,
  fields: TableField[]
): string | number | boolean {
  try {
    // Replace column references with values from the record
    let expr = formula;
    for (const field of fields) {
      const val = record[field.key];
      const num = Number(val);
      const pattern = new RegExp(`\\b${field.key}\\b`, "g");
      if (!isNaN(num) && val !== "" && val !== null && val !== undefined) {
        expr = expr.replace(pattern, String(num));
      } else {
        expr = expr.replace(pattern, JSON.stringify(String(val ?? "")));
      }
    }
    // Safe evaluation: only allow arithmetic and string operations
    // Replace unsafe patterns
    if (/[a-zA-Z_$]/.test(expr.replace(/true|false|null|undefined/g, ""))) {
      return `#ERR: invalid expression`;
    }
    // Evaluate arithmetic
    // eslint-disable-next-line no-eval
    const result = Function(`"use strict"; return (${expr})`)();
    if (typeof result === "number") {
      return isNaN(result) ? "#ERR" : Math.round(result * 100) / 100;
    }
    return String(result);
  } catch {
    return "#ERR";
  }
}

/** ── AI Field ───────────────────────────────────────────────────────────── */

export function AiFieldRenderer({
  field,
  record,
  generating,
  onGenerate,
}: {
  field: TableField;
  record: Record<string, unknown>;
  generating: boolean;
  onGenerate: (fieldKey: string, prompt: string, rowData: Record<string, unknown>) => void;
}) {
  const value = record[field.key];
  return (
    <div className="group flex items-center gap-1.5">
      {generating ? (
        <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
      ) : value ? (
        <Sparkles className="h-3 w-3 text-violet-400" />
      ) : (
        <Bot className="h-3 w-3 text-ink-muted" />
      )}
      <span className={cn(!value && "text-ink-muted italic")}>
        {generating ? "Generating…" : value ? String(value) : "— click to generate"}
      </span>
      {!value && !generating && (
        <button
          className="ml-1 rounded p-0.5 text-violet-500 opacity-0 transition group-hover:opacity-100 hover:bg-violet-50"
          title="Generate with AI"
          onClick={(e) => {
            e.stopPropagation();
            onGenerate(field.key, field.aiPrompt ?? "", record);
          }}
        >
          <Sparkles className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

/** ── Formula Field ──────────────────────────────────────────────────────── */

export function FormulaFieldRenderer({
  field,
  record,
  fields,
}: {
  field: TableField;
  record: Record<string, unknown>;
  fields: TableField[];
}) {
  if (!field.formula) return <span className="text-ink-muted italic">No formula</span>;
  const result = evaluateFormula(field.formula, record, fields);
  const isError = typeof result === "string" && result.startsWith("#ERR");
  return (
    <span className={cn("flex items-center gap-1", isError ? "text-danger" : "text-ink")}>
      <Calculator className="h-2.5 w-2.5 text-amber-500" />
      {typeof result === "number" ? result.toLocaleString() : result}
    </span>
  );
}

/** ── Button Workflow Field ──────────────────────────────────────────────── */

export function ButtonFieldRenderer({
  field,
  recordId,
  running,
  onRun,
}: {
  field: TableField;
  recordId: string;
  running: boolean;
  onRun: (workflowId: string, recordId: string) => void;
}) {
  if (!field.workflowId) return <span className="text-ink-muted italic">No workflow</span>;
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition",
        running
          ? "border-violet-200 bg-violet-50 text-violet-600"
          : "border-line bg-elevated text-ink hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
      )}
      disabled={running}
      onClick={(e) => {
        e.stopPropagation();
        onRun(field.workflowId!, recordId);
      }}
    >
      {running ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
      {field.buttonLabel ?? "Run"}
    </button>
  );
}

/** ── Linked Record Field ────────────────────────────────────────────────── */

export function LinkedRecordRenderer({
  field,
  value,
  allTables,
  onSelect,
}: {
  field: TableField;
  value: unknown;
  allTables: Array<{ id: string; name: string }>;
  onSelect: (fieldKey: string, linkedRecordId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const linkedTable = allTables.find((t) => t.id === field.linkedTableId);
  return (
    <div className="relative inline-flex items-center gap-1">
      <Link2 className="h-2.5 w-2.5 text-blue-500" />
      {value ? (
        <span className="text-blue-600 underline decoration-blue-200 underline-offset-2">
          {String(value)}
        </span>
      ) : (
        <button
          className="text-ink-muted italic hover:text-blue-600"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {linkedTable ? `Link ${linkedTable.name} record…` : "Link record…"}
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 rounded-xl border border-line bg-elevated p-2 shadow-lg">
          <p className="mb-1 text-[10px] font-medium text-ink-muted">
            Select from {linkedTable?.name ?? "linked table"}
          </p>
          <button
            className="w-full rounded-lg px-2 py-1 text-left text-xs text-ink hover:bg-muted"
            onClick={() => {
              onSelect(field.key, "demo-record-id");
              setOpen(false);
            }}
          >
            (demo) First record
          </button>
        </div>
      )}
    </div>
  );
}

/** ── Inline Cell Renderer ───────────────────────────────────────────────── */

export function TableCellRenderer({
  field,
  value,
  record,
  recordId,
  fields,
  allTables,
  aiGenerating,
  buttonRunning,
  onAiGenerate,
  onButtonRun,
  onLinkedSelect,
}: {
  field: TableField;
  value: unknown;
  record: Record<string, unknown>;
  recordId?: string;
  fields: TableField[];
  allTables: Array<{ id: string; name: string }>;
  aiGenerating?: boolean;
  buttonRunning?: boolean;
  onAiGenerate?: (fieldKey: string, prompt: string, rowData: Record<string, unknown>) => void;
  onButtonRun?: (workflowId: string, recordId: string) => void;
  onLinkedSelect?: (fieldKey: string, linkedRecordId: string) => void;
}) {
  switch (field.type) {
    case "ai":
      return onAiGenerate ? (
        <AiFieldRenderer field={field} record={record} generating={aiGenerating ?? false} onGenerate={onAiGenerate} />
      ) : (
        <span className="text-ink-muted">{String(value ?? "—")}</span>
      );
    case "formula":
      return <FormulaFieldRenderer field={field} record={record} fields={fields} />;
    case "button":
      return onButtonRun ? (
        <ButtonFieldRenderer field={field} recordId={recordId ?? ""} running={buttonRunning ?? false} onRun={onButtonRun} />
      ) : (
        <span className="text-ink-muted">—</span>
      );
    case "linked":
      return onLinkedSelect ? (
        <LinkedRecordRenderer field={field} value={value} allTables={allTables} onSelect={onLinkedSelect} />
      ) : (
        <span className="text-ink-muted">{String(value ?? "—")}</span>
      );
    case "checkbox":
      return (
        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded border", value ? "border-teal bg-teal/10 text-teal" : "border-line bg-white text-ink-muted")}>
          {value ? "✓" : ""}
        </span>
      );
    case "select":
      return (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink">
          {String(value ?? "—")}
        </span>
      );
    case "url":
      return value ? (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800">
          {String(value).length > 30 ? String(value).slice(0, 30) + "…" : String(value)}
        </a>
      ) : (
        <span className="text-ink-muted">—</span>
      );
    default:
      return <span>{String(value ?? "—")}</span>;
  }
}

/** ── Field Type Badge ───────────────────────────────────────────────────── */

const FIELD_TYPE_ICONS: Record<string, typeof Bot> = {
  ai: Bot,
  formula: Calculator,
  button: Zap,
  linked: Link2,
};

const FIELD_TYPE_COLORS: Record<string, string> = {
  ai: "bg-violet-100 text-violet-700",
  formula: "bg-amber-100 text-amber-700",
  button: "bg-teal-100 text-teal-700",
  linked: "bg-blue-100 text-blue-700",
};

export function FieldTypeBadge({ type }: { type: string }) {
  const Icon = FIELD_TYPE_ICONS[type];
  const color = FIELD_TYPE_COLORS[type] ?? "bg-muted text-ink-muted";
  if (!Icon) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium", color)}>
      <Icon className="h-2 w-2" />
      {type}
    </span>
  );
}
