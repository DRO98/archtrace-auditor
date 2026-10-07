import type { IndexedSubBlock } from "./graph";

export function findSubBlockAt(
  index: ReadonlyMap<string, readonly IndexedSubBlock[]>,
  filePath: string,
  line: number,
): IndexedSubBlock | null {
  const blocks = index.get(filePath);
  if (!blocks) return null;

  let best: IndexedSubBlock | null = null;
  for (const block of blocks) {
    if (line < block.startLine || line > block.endLine) continue;
    if (!best) {
      best = block;
      continue;
    }
    const span = block.endLine - block.startLine;
    const bestSpan = best.endLine - best.startLine;
    if (span < bestSpan || (span === bestSpan && block.startLine > best.startLine)) best = block;
  }
  return best;
}
