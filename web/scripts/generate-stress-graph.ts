import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodeGraph, CodeModule, CodeSubBlock, ModuleGroup } from "@core/graph";

const MODULE_COUNT = 250;
const EDGE_COUNT = 400;
const SEED = 0x5eed;

const GROUPS: readonly ModuleGroup[] = [
  { id: "api", label: "API Gateway", color: "sky" },
  { id: "rag", label: "RAG Pipeline", color: "violet" },
  { id: "db", label: "Database", color: "emerald" },
  { id: "llm", label: "LLM Service", color: "amber" },
  { id: "ui", label: "Interface", color: "rose" },
  { id: "jobs", label: "Jobs", color: "zinc" },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function moduleBlocks(filePath: string, count: number): CodeSubBlock[] {
  const classId = `${filePath}::Worker`;
  const methodCount = count - 1;
  const methods: CodeSubBlock[] = [];
  let cursor = 4;
  for (let index = 0; index < methodCount; index += 1) {
    const startLine = cursor;
    const endLine = cursor + 2;
    methods.push({
      id: `${filePath}::Worker.step_${index}`,
      kind: "method",
      name: `Worker.step_${index}`,
      range: { startLine, endLine },
      parentId: classId,
    });
    cursor = endLine + 1;
  }
  const classBlock: CodeSubBlock = {
    id: classId,
    kind: "class",
    name: "Worker",
    range: { startLine: 1, endLine: Math.max(2, cursor - 1) },
  };
  return [classBlock, ...methods];
}

function buildStressGraph(): CodeGraph {
  const random = mulberry32(SEED);
  const modules: CodeModule[] = [];
  for (let index = 0; index < MODULE_COUNT; index += 1) {
    const group = GROUPS[index % GROUPS.length];
    if (!group) continue;
    const filePath = `src/${group.id}/mod_${String(index).padStart(3, "0")}.py`;
    const count = 4 + Math.floor(random() * 9);
    modules.push({
      id: filePath,
      label: `mod_${String(index).padStart(3, "0")}.py`,
      filePath,
      groupId: group.id,
      language: "python",
      subBlocks: moduleBlocks(filePath, count),
    });
  }

  const edges: CodeGraph["edges"] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (edges.length < EDGE_COUNT && guard < 100_000) {
    guard += 1;
    const source = modules[Math.floor(random() * modules.length)];
    const target = modules[Math.floor(random() * modules.length)];
    if (!source || !target || source.id === target.id) continue;
    const id = `imports:${source.id}:${target.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, source: source.id, target: target.id, kind: "imports" });
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));

  return { version: 1, projectName: "stress", groups: [...GROUPS], modules, edges };
}

const destination = path.join(process.cwd(), "public", "graphs");
mkdirSync(destination, { recursive: true });
writeFileSync(path.join(destination, "stress.json"), `${JSON.stringify(buildStressGraph(), null, 2)}\n`, "utf8");
