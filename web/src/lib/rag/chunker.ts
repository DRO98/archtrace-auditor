/** Port de `sandbox/src/rag/chunker.py`: ventanas de texto solapadas para el índice. */

export const DEFAULT_CHUNK_SIZE = 240;
export const DEFAULT_CHUNK_OVERLAP = 40;

/** Junta los espacios para que ninguna ventana empiece o acabe en un hueco. */
function collapse(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Ventanas recortadas. La última puede ser más corta que `size`. */
export function chunkText(text: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  if (size <= 0) throw new RangeError("size must be positive");
  if (overlap < 0 || overlap >= size) throw new RangeError("overlap must be smaller than size");

  const cleaned = collapse(text);
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];

  const step = size - overlap;
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    const window = cleaned.slice(start, end).trim();
    if (window) chunks.push(window);
    if (end === cleaned.length) break;
    start += step;
  }
  return chunks;
}

/** Cuántas ventanas emitiría `chunkText` con los mismos argumentos. */
export function chunkCount(text: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): number {
  return chunkText(text, size, overlap).length;
}
