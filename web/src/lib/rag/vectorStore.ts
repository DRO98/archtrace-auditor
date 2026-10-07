/** Port de `sandbox/src/rag/vector_store.py`: índice en memoria por similitud coseno. */

export interface VectorRecord {
  recordId: string;
  text: string;
  values: readonly number[];
  source: string;
}

export interface VectorHit {
  record: VectorRecord;
  score: number;
}

export class VectorStore {
  readonly dimensions: number;
  private readonly records = new Map<string, VectorRecord>();

  constructor(dimensions: number) {
    if (dimensions <= 0) throw new RangeError("dimensions must be positive");
    this.dimensions = dimensions;
  }

  /** Inserta o reemplaza tras comprobar el ancho. */
  upsert(record: VectorRecord): void {
    this.requireWidth(record.values);
    this.records.set(record.recordId, record);
  }

  addMany(records: Iterable<VectorRecord>): number {
    let written = 0;
    for (const record of records) {
      this.upsert(record);
      written += 1;
    }
    return written;
  }

  delete(recordId: string): boolean {
    return this.records.delete(recordId);
  }

  get(recordId: string): VectorRecord | undefined {
    return this.records.get(recordId);
  }

  get size(): number {
    return this.records.size;
  }

  /** Los registros más cercanos, de mayor a menor similitud. */
  search(query: readonly number[], limit = 5): VectorHit[] {
    this.requireWidth(query);
    if (limit <= 0) return [];
    const ranked: VectorHit[] = [];
    for (const record of this.records.values()) {
      ranked.push({ record, score: cosineSimilarity(query, record.values) });
    }
    ranked.sort((left, right) => right.score - left.score);
    return ranked.slice(0, limit);
  }

  private requireWidth(values: readonly number[]): void {
    if (values.length !== this.dimensions) {
      throw new RangeError(`expected ${this.dimensions} dimensions, got ${values.length}`);
    }
  }
}

/** Similitud coseno en [0, 1] para vectores no negativos. Un vector nulo da 0. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new RangeError("vectors must share a dimension");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
