import type {
  CodeGraph,
  CodeModule,
  CodeSubBlock,
  EdgeKind,
  GroupColor,
  ModuleEdge,
  ModuleGroup,
  ModuleRole,
  SubBlockKind,
} from "@core/graph";
import type { LineRange } from "@core/protocol";

const GROUP_COLORS: ReadonlySet<GroupColor> = new Set([
  "sky",
  "emerald",
  "violet",
  "amber",
  "rose",
  "zinc",
]);

const SUB_BLOCK_KINDS: ReadonlySet<SubBlockKind> = new Set([
  "class",
  "function",
  "method",
  "block",
]);

const EDGE_KINDS: ReadonlySet<EdgeKind> = new Set(["imports", "calls", "data-flow"]);

const MODULE_ROLES: ReadonlySet<ModuleRole> = new Set([
  "api",
  "pipeline",
  "database",
  "cache",
  "broker",
  "stream",
  "rpc",
  "ai-model",
  "transform",
  "prompt",
  "app",
  "service",
  "ui",
  "util",
  "code",
]);

export interface IndexedSubBlock {
  id: string;
  moduleId: string;
  name: string;
  kind: SubBlockKind;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface GraphIndexes {
  modulesById: ReadonlyMap<string, CodeModule>;
  subBlocksByFile: ReadonlyMap<string, readonly IndexedSubBlock[]>;
  /** First module id declared for each file path. */
  modulesByFile: ReadonlyMap<string, string>;
  haystacks: ReadonlyMap<string, string>;
}

export type ParseResult = { ok: true; graph: CodeGraph } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosixRelative(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes("\\") || filePath.startsWith("/")) return false;
  if (filePath.startsWith("./")) return false;
  const first = filePath.charCodeAt(0);
  const letter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
  if (letter && filePath[1] === ":") return false;
  return filePath.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function readRange(value: unknown, label: string, errors: string[]): LineRange | null {
  if (!isRecord(value)) {
    errors.push(`${label}: rango inválido`);
    return null;
  }
  const { startLine, endLine } = value;
  if (typeof startLine !== "number" || !Number.isInteger(startLine) || startLine < 1) {
    errors.push(`${label}: startLine debe ser un entero ≥ 1`);
    return null;
  }
  if (typeof endLine !== "number" || !Number.isInteger(endLine) || endLine < 1) {
    errors.push(`${label}: endLine debe ser un entero ≥ 1`);
    return null;
  }
  if (endLine < startLine) {
    errors.push(`${label}: endLine < startLine`);
    return null;
  }
  return { startLine, endLine };
}

function parseGroups(value: unknown, errors: string[]): ModuleGroup[] {
  if (!Array.isArray(value)) {
    errors.push("groups debe ser una lista");
    return [];
  }
  const groups: ModuleGroup[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push("grupo con id inválido");
      continue;
    }
    if (seen.has(entry.id)) errors.push(`Id de grupo duplicado: ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.label !== "string" || entry.label.length === 0) {
      errors.push(`${entry.id}: label inválido`);
    }
    if (typeof entry.color !== "string" || !GROUP_COLORS.has(entry.color as GroupColor)) {
      errors.push(`${entry.id}: color inválido`);
      continue;
    }
    const group: ModuleGroup = { id: entry.id, label: typeof entry.label === "string" ? entry.label : entry.id, color: entry.color as GroupColor };
    if (typeof entry.summary === "string" && entry.summary.length > 0) group.summary = entry.summary;
    groups.push(group);
  }
  return groups;
}

function parseSubBlocks(value: unknown, moduleId: string, errors: string[], seenIds: Set<string>): CodeSubBlock[] {
  if (!Array.isArray(value)) {
    errors.push(`${moduleId}: subBlocks debe ser una lista`);
    return [];
  }
  const blocks: CodeSubBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push(`${moduleId}: sub-bloque con id inválido`);
      continue;
    }
    if (seenIds.has(entry.id)) errors.push(`Id de sub-bloque duplicado: ${entry.id}`);
    seenIds.add(entry.id);
    if (typeof entry.kind !== "string" || !SUB_BLOCK_KINDS.has(entry.kind as SubBlockKind)) {
      errors.push(`${entry.id}: kind inválido`);
      continue;
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      errors.push(`${entry.id}: name inválido`);
      continue;
    }
    const range = readRange(entry.range, entry.id, errors);
    if (!range) continue;
    const block: CodeSubBlock = { id: entry.id, kind: entry.kind as SubBlockKind, name: entry.name, range };
    if (entry.parentId !== undefined) {
      if (typeof entry.parentId !== "string" || entry.parentId.length === 0) {
        errors.push(`${entry.id}: parentId inválido`);
      } else {
        block.parentId = entry.parentId;
      }
    }
    if (entry.summary !== undefined) {
      if (typeof entry.summary !== "string") errors.push(`${entry.id}: summary inválido`);
      else block.summary = entry.summary;
    }
    blocks.push(block);
  }

  const localIds = new Set(blocks.map((block) => block.id));
  for (const block of blocks) {
    if (block.parentId !== undefined && !localIds.has(block.parentId)) {
      errors.push(`${block.name}: parentId inexistente`);
    }
  }
  return blocks;
}

function parseModules(value: unknown, groupIds: ReadonlySet<string>, errors: string[]): CodeModule[] {
  if (!Array.isArray(value)) {
    errors.push("modules debe ser una lista");
    return [];
  }
  const modules: CodeModule[] = [];
  const seen = new Set<string>();
  const seenBlocks = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push("módulo con id inválido");
      continue;
    }
    if (seen.has(entry.id)) errors.push(`Id de módulo duplicado: ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.filePath !== "string" || !isPosixRelative(entry.filePath)) {
      errors.push(`${entry.id}: filePath debe ser una ruta posix relativa`);
    }
    if (typeof entry.groupId !== "string" || !groupIds.has(entry.groupId)) {
      errors.push(`${entry.id}: groupId inexistente`);
    }
    if (typeof entry.label !== "string" || typeof entry.language !== "string") {
      errors.push(`${entry.id}: label o language inválido`);
    }
    const filePath = typeof entry.filePath === "string" ? entry.filePath : entry.id;
    const codeModule: CodeModule = {
      id: entry.id,
      label: typeof entry.label === "string" ? entry.label : entry.id,
      filePath,
      groupId: typeof entry.groupId === "string" ? entry.groupId : "",
      language: typeof entry.language === "string" ? entry.language : "",
      subBlocks: parseSubBlocks(entry.subBlocks, entry.id, errors, seenBlocks),
    };
    if (typeof entry.summary === "string") codeModule.summary = entry.summary;
    if (entry.role !== undefined) {
      if (typeof entry.role !== "string" || !MODULE_ROLES.has(entry.role as ModuleRole)) {
        errors.push(`${entry.id}: role inválido`);
      } else {
        codeModule.role = entry.role as ModuleRole;
      }
    }
    if (entry.subtitle !== undefined) {
      if (typeof entry.subtitle !== "string") errors.push(`${entry.id}: subtitle inválido`);
      else codeModule.subtitle = entry.subtitle;
    }
    if (entry.supportOf !== undefined) {
      if (typeof entry.supportOf !== "string") errors.push(`${entry.id}: supportOf inválido`);
      else codeModule.supportOf = entry.supportOf;
    }
    if (entry.layer !== undefined) {
      if (typeof entry.layer !== "number" || !Number.isInteger(entry.layer) || entry.layer < 0) {
        errors.push(`${entry.id}: layer debe ser un entero ≥ 0`);
      } else {
        codeModule.layer = entry.layer;
      }
    }
    if (entry.subsystem !== undefined) {
      if (typeof entry.subsystem !== "string" || entry.subsystem.length === 0) errors.push(`${entry.id}: subsystem inválido`);
      else codeModule.subsystem = entry.subsystem;
    }
    // Tecnologías y servicio del compose: sin ellos el mapa de sistema pierde logos y entradas de servicio.
    if (entry.tech !== undefined) {
      if (!Array.isArray(entry.tech) || !entry.tech.every((item) => typeof item === "string")) errors.push(`${entry.id}: tech inválido`);
      else if (entry.tech.length > 0) codeModule.tech = [...(entry.tech as string[])];
    }
    if (entry.service !== undefined) {
      if (typeof entry.service !== "string" || entry.service.length === 0) errors.push(`${entry.id}: service inválido`);
      else codeModule.service = entry.service;
    }
    modules.push(codeModule);
  }
  validateSupportLinks(modules, errors);
  return modules;
}

function validateSupportLinks(modules: readonly CodeModule[], errors: string[]): void {
  const byId = new Map(modules.map((item) => [item.id, item]));
  for (const item of modules) {
    if (item.supportOf === undefined) continue;
    if (item.supportOf === item.id) {
      errors.push(`${item.id}: supportOf apunta a sí mismo`);
      continue;
    }
    const parent = byId.get(item.supportOf);
    if (!parent) {
      errors.push(`${item.id}: supportOf inexistente`);
      continue;
    }
    if (parent.supportOf !== undefined) {
      errors.push(`${item.id}: supportOf apunta a otro módulo de apoyo`);
    }
  }
}

function parseEdges(value: unknown, moduleIds: ReadonlySet<string>, errors: string[]): ModuleEdge[] {
  if (!Array.isArray(value)) {
    errors.push("edges debe ser una lista");
    return [];
  }
  const edges: ModuleEdge[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push("arista con id inválido");
      continue;
    }
    if (seen.has(entry.id)) errors.push(`Id de arista duplicado: ${entry.id}`);
    seen.add(entry.id);
    if (typeof entry.kind !== "string" || !EDGE_KINDS.has(entry.kind as EdgeKind)) {
      errors.push(`${entry.id}: kind inválido`);
      continue;
    }
    if (typeof entry.source !== "string" || !moduleIds.has(entry.source)) {
      errors.push(`${entry.id}: arista hacia un módulo inexistente`);
    }
    if (typeof entry.target !== "string" || !moduleIds.has(entry.target)) {
      errors.push(`${entry.id}: arista hacia un módulo inexistente`);
    }
    const edge: ModuleEdge = {
      id: entry.id,
      source: typeof entry.source === "string" ? entry.source : "",
      target: typeof entry.target === "string" ? entry.target : "",
      kind: entry.kind as EdgeKind,
    };
    if (typeof entry.label === "string") edge.label = entry.label;
    edges.push(edge);
  }
  return edges;
}

export function parseCodeGraph(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, errors: ["El grafo debe ser un objeto"] };
  const errors: string[] = [];
  if (value.version !== 1) errors.push("version debe ser 1");
  if (typeof value.projectName !== "string" || value.projectName.length === 0) {
    errors.push("projectName inválido");
  }
  const groups = parseGroups(value.groups, errors);
  const modules = parseModules(value.modules, new Set(groups.map((group) => group.id)), errors);
  const edges = parseEdges(value.edges, new Set(modules.map((item) => item.id)), errors);
  const subsystems = value.subsystems === undefined ? undefined : parseGroups(value.subsystems, errors);
  if (subsystems) {
    const known = new Set(subsystems.map((item) => item.id));
    for (const item of modules) {
      if (item.subsystem !== undefined && !known.has(item.subsystem)) errors.push(`${item.id}: subsystem inexistente`);
    }
  }
  if (errors.length > 0 || typeof value.projectName !== "string") return { ok: false, errors };
  const graph: CodeGraph = { version: 1, projectName: value.projectName, groups, modules, edges };
  if (subsystems) graph.subsystems = subsystems;
  const omitted = value.omitted;
  if (isRecord(omitted) && Array.isArray(omitted.paths)) {
    const paths = omitted.paths.filter((item): item is string => typeof item === "string");
    graph.omitted = { count: typeof omitted.count === "number" ? Math.max(omitted.count, paths.length) : paths.length, paths };
  }
  return { ok: true, graph };
}

function unqualified(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

function declarationMatches(line: string, name: string): boolean {
  const trimmed = line.trim();
  const heads = [`async def ${name}`, `class ${name}`, `def ${name}`];
  for (const head of heads) {
    if (!trimmed.startsWith(head)) continue;
    const next = trimmed.charAt(head.length);
    if (next === "" || next === "(" || next === ":" || next === " " || next === "[" || next === "\t") return true;
  }
  return false;
}

function firstCodeLine(lines: readonly string[], startLine: number): string | null {
  for (let index = startLine - 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trimStart().startsWith("@")) continue;
    return line;
  }
  return null;
}

export function validateRanges(graph: CodeGraph, readSource: (filePath: string) => string | null): string[] {
  const errors: string[] = [];
  for (const item of graph.modules) {
    const source = readSource(item.filePath);
    if (source === null) {
      if (item.subBlocks.length === 0) errors.push(`${item.filePath}: archivo inexistente`);
      for (const block of item.subBlocks) {
        errors.push(`${item.filePath} · ${block.name}: archivo inexistente`);
      }
      continue;
    }
    const lines = source.split(/\r?\n/);
    for (const block of item.subBlocks) {
      if (block.range.endLine > lines.length) {
        errors.push(`${item.filePath} · ${block.name}: endLine fuera del archivo`);
        continue;
      }
      if (block.kind === "block") continue;
      const line = firstCodeLine(lines, block.range.startLine);
      if (line === null || !declarationMatches(line, unqualified(block.name))) {
        errors.push(`${item.filePath} · ${block.name}: la declaración no coincide`);
      }
    }
  }
  return errors;
}

export function buildIndexes(graph: CodeGraph): GraphIndexes {
  const modulesById = new Map<string, CodeModule>();
  const subBlocksByFile = new Map<string, IndexedSubBlock[]>();
  const modulesByFile = new Map<string, string>();
  const haystacks = new Map<string, string>();

  for (const item of graph.modules) {
    modulesById.set(item.id, item);
    if (!modulesByFile.has(item.filePath)) modulesByFile.set(item.filePath, item.id);
    const indexed = item.subBlocks.map((block) => ({
      id: block.id,
      moduleId: item.id,
      name: block.name,
      kind: block.kind,
      filePath: item.filePath,
      startLine: block.range.startLine,
      endLine: block.range.endLine,
    }));
    const bucket = subBlocksByFile.get(item.filePath);
    if (bucket) bucket.push(...indexed);
    else subBlocksByFile.set(item.filePath, indexed);
    const names = item.subBlocks.map((block) => block.name).join(" ");
    haystacks.set(item.id, `${item.label} ${item.filePath} ${names}`.toLowerCase());
  }

  for (const list of subBlocksByFile.values()) {
    list.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
  }

  return { modulesById, subBlocksByFile, modulesByFile, haystacks };
}

export function moduleRange(codeModule: CodeModule): LineRange | null {
  const first = codeModule.subBlocks[0];
  if (!first) return null;
  let startLine = first.range.startLine;
  let endLine = first.range.endLine;
  for (const block of codeModule.subBlocks) {
    if (block.range.startLine < startLine) startLine = block.range.startLine;
    if (block.range.endLine > endLine) endLine = block.range.endLine;
  }
  return { startLine, endLine };
}
