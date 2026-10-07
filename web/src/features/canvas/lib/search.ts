import type { SubBlockKind } from "@core/graph";
import type { GraphIndexes } from "./graph";

export interface MatchResult {
  modules: ReadonlySet<string>;
  subBlocks: ReadonlySet<string>;
}

export interface ModuleFilter {
  query: string;
  groups: ReadonlySet<string>;
  kinds: ReadonlySet<SubBlockKind>;
}

export function matchModules(indexes: GraphIndexes, filter: ModuleFilter): MatchResult | null {
  const tokens = filter.query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0 && filter.groups.size === 0 && filter.kinds.size === 0) return null;

  const modules = new Set<string>();
  const subBlocks = new Set<string>();
  for (const item of indexes.modulesById.values()) {
    if (filter.groups.size > 0 && !filter.groups.has(item.groupId)) continue;
    if (filter.kinds.size > 0 && !item.subBlocks.some((block) => filter.kinds.has(block.kind))) continue;
    const haystack = indexes.haystacks.get(item.id) ?? "";
    if (tokens.some((token) => !haystack.includes(token))) continue;
    modules.add(item.id);
    for (const block of item.subBlocks) {
      const name = block.name.toLowerCase();
      if (tokens.some((token) => name.includes(token))) subBlocks.add(block.id);
    }
  }
  return { modules, subBlocks };
}
