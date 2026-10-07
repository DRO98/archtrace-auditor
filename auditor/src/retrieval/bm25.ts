import { fold, type DocSection } from "../docs/sections";

/**
 * Recuperación de secciones de documentación: BM25 léxico en memoria (siempre) y, si hay Qdrant + Ollama,
 * híbrido BM25 + vectores (`vectorIndex.ts`) con la misma interfaz.
 */
export interface Retriever {
  search(query: string, limit: number): Promise<Array<{ section: DocSection; score: number }>>;
}

const K1 = 1.2;
const B = 0.75;
const STOPWORDS = new Set(
  "the a an and or of to in on for is are be with this that it as by at from el la los las un una y o de del en para por con que se es son al lo su sus no si self return def const let var function import export".split(" "),
);

export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9_]+/)
    .flatMap((token) => (token.includes("_") ? [token, ...token.split("_")] : [token]))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export class Bm25Retriever implements Retriever {
  private readonly docs: Array<{ section: DocSection; terms: Map<string, number>; length: number }>;
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(sections: readonly DocSection[]) {
    this.docs = sections.map((section) => {
      const tokens = tokenize(`${section.headingPath.join(" ")} ${section.headingPath.join(" ")} ${section.text}`);
      const terms = new Map<string, number>();
      for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
      for (const token of terms.keys()) this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      return { section, terms, length: tokens.length };
    });
    this.averageLength = this.docs.reduce((total, doc) => total + doc.length, 0) / Math.max(1, this.docs.length);
  }

  async search(query: string, limit: number): Promise<Array<{ section: DocSection; score: number }>> {
    return this.searchSync(query, limit);
  }

  searchSync(query: string, limit: number): Array<{ section: DocSection; score: number }> {
    const terms = [...new Set(tokenize(query))];
    const total = this.docs.length;
    const scored = this.docs.map((doc) => {
      let score = 0;
      for (const term of terms) {
        const frequency = doc.terms.get(term);
        if (!frequency) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        score += (idf * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * doc.length) / (this.averageLength || 1)));
      }
      return { section: doc.section, score };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.section.id.localeCompare(right.section.id))
      .slice(0, limit);
  }
}
