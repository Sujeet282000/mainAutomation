import type { ModelGateway } from "@algoverge/model-gateway";
import type { OperationCard, PieceRegistry } from "./registry";

export interface PieceEmbeddingRow {
  piece_name: string;
  op_kind: string;
  op_name: string;
  text: string;
  embedding: number[];
}

export interface CatalogDb {
  upsertPieceEmbeddings(rows: Array<{
    pieceName: string;
    opKind: string;
    opName: string;
    text: string;
    embedding: number[];
  }>): Promise<void>;
  searchEmbeddings(vec: number[], kind: "trigger" | "action" | undefined, k: number): Promise<PieceEmbeddingRow[]>;
  searchTrigram(query: string, kind: "trigger" | "action" | undefined, k: number): Promise<PieceEmbeddingRow[]>;
}

/** Hybrid retrieval: vector + keyword, reciprocal-rank fused. */
export class CatalogIndex {
  private rows: PieceEmbeddingRow[] = [];

  constructor(
    private reg: PieceRegistry,
    private ai: ModelGateway,
    private db?: CatalogDb
  ) {}

  async reindex() {
    const cards = this.reg.cards();
    const texts = cards.map(
      (c) =>
        `${c.pieceDisplay} — ${c.display}. ${c.description} Also known as: ${c.aliases.join(", ")}. Kind: ${c.kind}.`
    );
    const vectors = await this.ai.embedBatch(texts);
    const mapped = cards.map((c, i) => ({
      pieceName: c.piece,
      opKind: c.kind,
      opName: c.operation,
      text: texts[i],
      embedding: vectors[i]
    }));
    if (this.db) await this.db.upsertPieceEmbeddings(mapped);
    this.rows = mapped.map((m) => ({
      piece_name: m.pieceName,
      op_kind: m.opKind,
      op_name: m.opName,
      text: m.text,
      embedding: m.embedding
    }));
  }

  async search(query: string, kind?: "trigger" | "action", k = 12): Promise<OperationCard[]> {
    if (!this.rows.length) {
      const cards = this.reg.cards().filter((c) => !kind || c.kind === kind);
      const q = query.toLowerCase();
      return cards
        .map((c) => ({
          c,
          s:
            `${c.piece} ${c.pieceDisplay} ${c.display} ${c.aliases.join(" ")} ${c.description}`.toLowerCase().includes(q) ? 10 : overlap(q, `${c.pieceDisplay} ${c.display} ${c.aliases.join(" ")}`.toLowerCase())
        }))
        .sort((a, b) => b.s - a.s)
        .slice(0, k)
        .map((x) => x.c);
    }
    const [vec] = await this.ai.embedBatch([query]);
    const dense = this.rankDense(vec, kind, k * 2);
    const lexical = this.rankLexical(query, kind, k * 2);
    const score = new Map<string, number>();
    const add = (rows: PieceEmbeddingRow[], w: number) =>
      rows.forEach((r, i) => {
        const key = `${r.piece_name}:${r.op_kind}:${r.op_name}`;
        score.set(key, (score.get(key) ?? 0) + w / (60 + i));
      });
    add(dense, 1);
    add(lexical, 0.8);
    const all = this.reg.cards();
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([key]) => {
        const [piece, kindK, op] = key.split(":");
        return all.find((c) => c.piece === piece && c.kind === kindK && c.operation === op);
      })
      .filter((c): c is OperationCard => Boolean(c));
  }

  private rankDense(vec: number[], kind: "trigger" | "action" | undefined, k: number) {
    return this.rows
      .filter((r) => !kind || r.op_kind === kind)
      .map((r) => ({ r, s: cosine(vec, r.embedding) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.r);
  }

  private rankLexical(query: string, kind: "trigger" | "action" | undefined, k: number) {
    const q = query.toLowerCase();
    return this.rows
      .filter((r) => !kind || r.op_kind === kind)
      .map((r) => ({ r, s: r.text.toLowerCase().includes(q) ? q.length : overlap(q, r.text.toLowerCase()) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.r);
  }
}

function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function overlap(q: string, text: string) {
  const toks = q.split(/\s+/).filter(Boolean);
  return toks.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
}
