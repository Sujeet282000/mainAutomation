export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredResult<T> {
  parsed: T;
  raw: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Spec: Model Gateway is the AI plane's front door. */
export class ModelGateway {
  constructor(
    private embedFn?: (texts: string[]) => Promise<number[][]>,
    private completeFn?: (messages: ChatMessage[], jsonSchema?: unknown) => Promise<string>
  ) {}

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.embedFn) return this.embedFn(texts);
    return texts.map((t) => lexicalEmbedding(t));
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (this.completeFn) return this.completeFn(messages);
    throw new Error("MODEL_GATEWAY_UNCONFIGURED");
  }

  async completeStructured<T>(messages: ChatMessage[], parse: (raw: string) => T): Promise<StructuredResult<T>> {
    const raw = await this.complete(messages);
    return {
      parsed: parse(raw),
      raw,
      model: "configured",
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}

function lexicalEmbedding(text: string, dim = 64): number[] {
  const v = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    v[h % dim] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
