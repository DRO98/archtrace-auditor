/**
 * Port de `sandbox/src/rag/embeddings.py`: bolsa de palabras hasheada a un ancho fijo. No es un modelo.
 * Python usa `hash()` (aleatorio por proceso); aquí se usa FNV-1a para que los vectores sean deterministas.
 */

export const DEFAULT_DIMENSIONS = 32;

/** Minúsculas y solo letras o dígitos. */
export function normalize(token: string): string {
  let kept = "";
  for (const char of token.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(char)) kept += char;
  }
  return kept;
}

/** FNV-1a de 32 bits, sin signo. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Embedder {
  readonly dimensions: number;

  constructor(dimensions = DEFAULT_DIMENSIONS) {
    if (dimensions <= 0) throw new RangeError("dimensions must be positive");
    this.dimensions = dimensions;
  }

  /** Cuenta los tokens normalizados en `dimensions` cubetas y normaliza por el total. */
  embed(text: string): number[] {
    const counts = new Map<number, number>();
    let total = 0;
    for (const raw of text.split(/\s+/)) {
      const token = normalize(raw);
      if (!token) continue;
      const bucket = fnv1a(token) % this.dimensions;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      total += 1;
    }

    const vector = new Array<number>(this.dimensions).fill(0);
    if (total === 0) return vector;
    for (const [bucket, seen] of counts) vector[bucket] = seen / total;
    return vector;
  }

  embedMany(texts: readonly string[]): number[][] {
    return texts.map((text) => this.embed(text));
  }
}
