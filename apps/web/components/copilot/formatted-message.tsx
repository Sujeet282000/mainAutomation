import { Fragment, type ReactNode } from "react";

/**
 * FormattedCopilotMessage — renders Copilot/AI message text that may contain
 * safe inline HTML from the backend (or plain text) into friendly UI.
 *
 * Supported backend markup (produced by the AI plane):
 *   <b>/<strong>, <i>/<em>, <code>, <br>, <ul>/<ol>/<li>, <a href>, <p>
 *   <span class="ok|warn|err|hl">…</span>  — colored highlights
 *
 * Plain text (and markdown from AI providers) is normalized first:
 *   **bold** → <b>, *italic* → <i>, `code` → <code>, bullets → <li>,
 *   HTTP status codes (429, 401…) and {{field}} mappings → highlighted.
 *
 * Everything else is escaped: we never use dangerouslySetInnerHTML with raw
 * strings. The allowlist below parses the small tag set we trust and rebuilds
 * it as React nodes, so no untrusted attribute (event handlers, styles) can
 * reach the DOM.
 */

const ALLOWED_TAG = /<(\/?(?:b|strong|i|em|code|ul|ol|li|a|p|span|br)\b[^>]*)>/gi;

export function formatCopilotText(text: string): string {
  // Escape first, then rebuild trusted markup ourselves. Allowlisted tags that
  // already exist in backend HTML are parked in sentinels so they survive the
  // escape pass — mixed HTML+markdown messages keep their tags AND get their
  // markdown (tables, bold, bullets) normalized instead of leaking raw syntax.
  const parked = text
    .replace(/&/g, "&amp;")
    .replace(ALLOWED_TAG, "\u0001$1\u0002")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u0001/g, "<")
    .replace(/\u0002/g, ">");
  const lines = parked.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Markdown table rows: | A | B | C | → one list item per row; separator
    // rows (|---|---|) are dropped entirely.
    if (/^\|.*\|$/.test(trimmed)) {
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length) out.push(`<li>${cells.map(inlineMarkdown).join(" · ")}</li>`);
      continue;
    }
    if (/^[-•*]\s+/.test(trimmed)) { out.push(`<li>${inlineMarkdown(trimmed.replace(/^[-•*]\s+/, ""))}</li>`); continue; }
    if (/^\d+[.)]\s+/.test(trimmed)) { out.push(`<li>${inlineMarkdown(trimmed.replace(/^\d+[.)]\s+/, ""))}</li>`); continue; }
    out.push(inlineMarkdown(trimmed));
  }
  return out.join("\n");
}

/** Convert markdown inline syntax to the trusted HTML subset. Input is already escaped. */
function inlineMarkdown(line: string): string {
  let out = line;
  // `code` → <code> (do this first so bold/italic inside code stays literal)
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // **bold** → <b>
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  // *italic* / _italic_ → <i> (only single unmatched asterisks)
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<i>$2</i>");
  // {{trigger.row[1]}} style mapping tokens → highlighted
  out = out.replace(/(\{\{[^}]+\}\})/g, '<span class="hl">$1</span>');
  // HTTP status codes like 429 / 401 / 500 → highlighted
  out = out.replace(/\b(4\d{2}|5\d{2})\b(?=\s|$|:|,|\.)/g, '<span class="err">$1</span>');
  return out;
}

const CLASS_COLORS: Record<string, string> = {
  ok: "text-ok font-medium",
  warn: "text-warn font-medium",
  err: "text-danger font-medium",
  hl: "bg-violet-500/10 text-violet-600 dark:text-violet-300 rounded px-1 font-medium",
};

/** Render trusted markup to React nodes. Text (untrusted) is escaped first. */
export function renderMarkup(html: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\/?)(b|strong|i|em|code|ul|ol|li|a|p|span|br)((?:\s+[a-zA-Z-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
  const stack: Array<{ name: string; attrs: Record<string, string>; children: ReactNode[] }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (node: ReactNode) => {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else out.push(node);
  };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  while ((m = re.exec(html))) {
    if (m.index > last) push(esc(html.slice(last, m.index)));
    const [full, close, name, attrSrc] = m;
    last = m.index + full.length;
    if (name === "br") { push(<br key={`br${m.index}`} />); continue; }
    if (close) {
      const open = stack.pop();
      if (open && open.name === name) push(wrap(open.name, open.attrs, open.children, m.index));
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /(href|class|target|rel)\s*=\s*"([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrSrc ?? ""))) attrs[am[1]] = am[2];
    stack.push({ name, attrs, children: [] });
    void attrSrc;
  }
  if (last < html.length) push(esc(html.slice(last)));
  while (stack.length) {
    const open = stack.pop()!;
    push(wrap(open.name, open.attrs, open.children, 0));
  }
  return out;
}

function wrap(name: string, attrs: Record<string, string>, children: ReactNode[], key: number): ReactNode {
  switch (name) {
    case "b": case "strong": return <strong key={key}>{children}</strong>;
    case "i": case "em": return <em key={key}>{children}</em>;
    case "code": return <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-violet-600 dark:text-violet-300">{children}</code>;
    case "ul": return <ul key={key} className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>;
    case "ol": return <ol key={key} className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>;
    case "li": return <li key={key}>{children}</li>;
    case "p": return <p key={key}>{children}</p>;
    case "a": return <a key={key} href={attrs.href} target="_blank" rel="noreferrer" className="text-teal underline underline-offset-2">{children}</a>;
    case "span": {
      const cls = CLASS_COLORS[attrs.class ?? ""] ?? "font-medium";
      return <span key={key} className={cls}>{children}</span>;
    }
    default: return <Fragment key={key}>{children}</Fragment>;
  }
}

export function FormattedCopilotMessage({ text, className }: { text: string; className?: string }) {
  // Markdown detection now includes pipe-tables. When ANY markdown marker is
  // present we run the normalizer (which now PRESERVES allowlisted tags), so
  // mixed HTML+markdown never leaks raw | or ** into the UI.
  const hasMarkdown = /\*\*[^*]+\*\*|`[^`]+`|(^|\n)\s*[-•*]\s+|(^|\n)\s*\|.*\|/m.test(text);
  const looksLikeHtml = /<\s*(b|strong|i|em|code|ul|ol|li|a|p|span|br)[\s>]/i.test(text);
  const content = !hasMarkdown && looksLikeHtml
    ? renderMarkup(text)
    : renderMarkup(formatCopilotText(text));
  return <div className={className}>{content}</div>;
}
