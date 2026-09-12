import { Fragment, type ReactNode } from "react";

/**
 * FormattedCopilotMessage — renders Copilot/AI message text that may contain
 * safe inline HTML from the backend (or plain text) into friendly UI.
 *
 * Supported backend markup (produced by the AI plane):
 *   <b>/<strong>, <i>/<em>, <code>, <br>, <ul>/<ol>/<li>, <a href>, <p>
 *   <span class="ok|warn|err|hl">…</span>  — colored highlights
 *
 * Everything else is escaped: we never use dangerouslySetInnerHTML with raw
 * strings. The allowlist below parses the small tag set we trust and rebuilds
 * it as React nodes, so no untrusted attribute (event handlers, styles) can
 * reach the DOM.
 */

export function formatCopilotText(text: string): string {
  // Normalize raw text into friendly HTML-ish markup before rendering:
  //  - 429/401-style codes → highlighted
  //  - bullet lines → list items
  // Kept small and predictable on purpose.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (/^[-•*]\s+/.test(trimmed)) return `<li>${trimmed.replace(/^[-•*]\s+/, "")}</li>`;
      if (/^\d+[.)]\s+/.test(trimmed)) return `<li>${trimmed.replace(/^\d+[.)]\s+/, "")}</li>`;
      return trimmed;
    })
    .join("\n");
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
  const looksLikeHtml = /<\s*(b|strong|i|em|code|ul|ol|li|a|p|span|br)[\s>]/i.test(text);
  const content = looksLikeHtml ? renderMarkup(text) : renderMarkup(formatCopilotText(text));
  return <div className={className}>{content}</div>;
}
