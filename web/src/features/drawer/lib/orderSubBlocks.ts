import type { CodeSubBlock } from "@core/graph";

export function orderSubBlocks(blocks: readonly CodeSubBlock[]): CodeSubBlock[] {
  const methods = new Map<string, CodeSubBlock[]>();
  const tops: CodeSubBlock[] = [];
  for (const block of blocks) {
    if (block.parentId) {
      const list = methods.get(block.parentId);
      if (list) list.push(block);
      else methods.set(block.parentId, [block]);
    } else {
      tops.push(block);
    }
  }
  const ordered: CodeSubBlock[] = [];
  const placed = new Set<string>();
  for (const block of tops) {
    ordered.push(block);
    placed.add(block.id);
    const children = methods.get(block.id) ?? [];
    ordered.push(...children);
    for (const child of children) placed.add(child.id);
  }
  for (const block of blocks) {
    if (!placed.has(block.id)) ordered.push(block);
  }
  return ordered;
}
