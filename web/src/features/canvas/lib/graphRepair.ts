import type { CodeGraph, EdgeKind, GroupColor, ModuleRole, SubBlockKind } from "@core/graph";
import { parseCodeGraph } from "./graph";

/**
 * Reparación del grafo para la app (no para los scripts de validación, que siguen siendo estrictos).
 * Descarta o completa lo que impediría pintar el lienzo — aristas hacia módulos inexistentes, módulos
 * sin `label` o sin `filePath`, grupos desconocidos, `supportOf` rotos… — y anota cada arreglo en
 * `warnings` para que el usuario sepa que el grafo venía dañado.
 */

const GROUP_COLORS: ReadonlySet<string> = new Set<GroupColor>(["sky", "emerald", "violet", "amber", "rose", "zinc"]);
const SUB_BLOCK_KINDS: ReadonlySet<string> = new Set<SubBlockKind>(["class", "function", "method", "block"]);
const EDGE_KINDS: ReadonlySet<string> = new Set<EdgeKind>(["imports", "calls", "data-flow"]);
const MODULE_ROLES: ReadonlySet<string> = new Set<ModuleRole>([
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

const FALLBACK_GROUP = { id: "__otros", label: "Otros", color: "zinc" } as const;

type Rec = Record<string, unknown>;

export type LoadedGraph = { ok: true; graph: CodeGraph; warnings: string[] } | { ok: false; errors: string[] };

/** Parseo estricto; si falla, repara y vuelve a parsear. Solo un grafo irrecuperable devuelve errores. */
export function loadCodeGraph(raw: unknown): LoadedGraph {
  const strict = parseCodeGraph(raw);
  if (strict.ok) return { ok: true, graph: strict.graph, warnings: [] };
  const repaired = repairCodeGraph(raw);
  if (!repaired) return { ok: false, errors: strict.errors };
  const parsed = parseCodeGraph(repaired.raw);
  if (!parsed.ok) return { ok: false, errors: strict.errors };
  return { ok: true, graph: parsed.graph, warnings: repaired.warnings };
}

export function repairCodeGraph(raw: unknown): { raw: Rec; warnings: string[] } | null {
  if (!isRecord(raw) || !Array.isArray(raw.modules)) return null;
  const warnings: string[] = [];

  const groups = repairGroups(raw.groups, "grupo", warnings);
  const subsystems = raw.subsystems === undefined ? undefined : repairGroups(raw.subsystems, "subsistema", warnings);
  const groupIds = new Set(groups.map((group) => group.id));
  const subsystemIds = new Set((subsystems ?? []).map((item) => item.id));

  const modules: Rec[] = [];
  const moduleIds = new Set<string>();
  const blockIds = new Set<string>();
  let needsFallbackGroup = false;
  for (const entry of raw.modules) {
    if (!isRecord(entry) || !nonEmpty(entry.id)) {
      warnings.push("Se descartó un módulo sin id.");
      continue;
    }
    const id = entry.id;
    if (moduleIds.has(id)) {
      warnings.push(`Se descartó el módulo duplicado ${id}.`);
      continue;
    }
    const filePath = normalizePath(nonEmpty(entry.filePath) ? entry.filePath : id);
    if (!filePath) {
      warnings.push(`Se descartó ${id}: no tiene una ruta de archivo válida.`);
      continue;
    }
    moduleIds.add(id);
    const label = nonEmpty(entry.label) ? entry.label : basename(filePath);
    if (!nonEmpty(entry.label)) warnings.push(`${id} no tenía nombre: se usa «${label}».`);
    let groupId = typeof entry.groupId === "string" ? entry.groupId : "";
    if (!groupIds.has(groupId)) {
      groupId = FALLBACK_GROUP.id;
      needsFallbackGroup = true;
      warnings.push(`${id} apuntaba a un grupo inexistente: se movió a «${FALLBACK_GROUP.label}».`);
    }
    const repaired: Rec = {
      id,
      label,
      filePath,
      groupId,
      language: typeof entry.language === "string" ? entry.language : "",
      subBlocks: repairSubBlocks(entry.subBlocks, id, blockIds, warnings),
    };
    if (typeof entry.summary === "string") repaired.summary = entry.summary;
    if (typeof entry.subtitle === "string") repaired.subtitle = entry.subtitle;
    if (typeof entry.role === "string" && MODULE_ROLES.has(entry.role)) repaired.role = entry.role;
    if (nonEmpty(entry.service)) repaired.service = entry.service;
    if (Array.isArray(entry.tech)) {
      const tech = entry.tech.filter((item): item is string => nonEmpty(item));
      if (tech.length > 0) repaired.tech = tech;
    }
    if (typeof entry.layer === "number" && Number.isInteger(entry.layer) && entry.layer >= 0) repaired.layer = entry.layer;
    if (typeof entry.subsystem === "string" && subsystemIds.has(entry.subsystem)) repaired.subsystem = entry.subsystem;
    if (typeof entry.supportOf === "string") repaired.supportOf = entry.supportOf;
    modules.push(repaired);
  }
  repairSupportLinks(modules, warnings);

  const edges = repairEdges(raw.edges, moduleIds, warnings);
  if (needsFallbackGroup) groups.push({ ...FALLBACK_GROUP });

  const out: Rec = {
    version: 1,
    projectName: nonEmpty(raw.projectName) ? raw.projectName : "Proyecto",
    groups,
    modules,
    edges,
  };
  if (subsystems) out.subsystems = subsystems;
  const omitted = raw.omitted;
  if (isRecord(omitted) && Array.isArray(omitted.paths)) {
    const paths = omitted.paths.filter((item): item is string => nonEmpty(item));
    out.omitted = { count: typeof omitted.count === "number" ? Math.max(omitted.count, paths.length) : paths.length, paths };
  }
  return { raw: out, warnings };
}

function repairGroups(value: unknown, noun: string, warnings: string[]): Array<{ id: string; label: string; color: string; summary?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ id: string; label: string; color: string; summary?: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !nonEmpty(entry.id) || seen.has(entry.id)) {
      warnings.push(`Se descartó un ${noun} sin id o duplicado.`);
      continue;
    }
    seen.add(entry.id);
    const color = typeof entry.color === "string" && GROUP_COLORS.has(entry.color) ? entry.color : "zinc";
    const group: { id: string; label: string; color: string; summary?: string } = { id: entry.id, label: nonEmpty(entry.label) ? entry.label : entry.id, color };
    if (nonEmpty(entry.summary)) group.summary = entry.summary;
    out.push(group);
  }
  return out;
}

function repairSubBlocks(value: unknown, moduleId: string, seen: Set<string>, warnings: string[]): Rec[] {
  if (!Array.isArray(value)) return [];
  const blocks: Rec[] = [];
  let dropped = 0;
  for (const entry of value) {
    const range = isRecord(entry) ? readRange(entry.range) : null;
    if (
      !isRecord(entry) ||
      !nonEmpty(entry.id) ||
      seen.has(entry.id) ||
      typeof entry.kind !== "string" ||
      !SUB_BLOCK_KINDS.has(entry.kind) ||
      !nonEmpty(entry.name) ||
      !range
    ) {
      dropped += 1;
      continue;
    }
    seen.add(entry.id);
    const block: Rec = { id: entry.id, kind: entry.kind, name: entry.name, range };
    if (nonEmpty(entry.parentId)) block.parentId = entry.parentId;
    if (typeof entry.summary === "string") block.summary = entry.summary;
    blocks.push(block);
  }
  const ids = new Set(blocks.map((block) => block.id));
  for (const block of blocks) {
    if (typeof block.parentId === "string" && !ids.has(block.parentId)) delete block.parentId;
  }
  if (dropped > 0) warnings.push(`${moduleId}: se descartaron ${dropped} bloques de código inválidos.`);
  return blocks;
}

function repairSupportLinks(modules: Rec[], warnings: string[]): void {
  const byId = new Map(modules.map((item) => [item.id as string, item]));
  for (const item of modules) {
    const parentId = item.supportOf;
    if (typeof parentId !== "string") continue;
    const parent = byId.get(parentId);
    if (parentId === item.id || !parent || typeof parent.supportOf === "string") {
      delete item.supportOf;
      warnings.push(`${String(item.id)}: se ignoró un vínculo de apoyo roto.`);
    }
  }
}

function repairEdges(value: unknown, moduleIds: ReadonlySet<string>, warnings: string[]): Rec[] {
  if (!Array.isArray(value)) return [];
  const edges: Rec[] = [];
  const seen = new Set<string>();
  let dangling = 0;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { source, target } = entry;
    if (typeof source !== "string" || typeof target !== "string" || !moduleIds.has(source) || !moduleIds.has(target)) {
      dangling += 1;
      continue;
    }
    const id = nonEmpty(entry.id) ? entry.id : `${source}->${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = typeof entry.kind === "string" && EDGE_KINDS.has(entry.kind) ? entry.kind : "imports";
    const edge: Rec = { id, source, target, kind };
    if (typeof entry.label === "string") edge.label = entry.label;
    edges.push(edge);
  }
  if (dangling > 0) warnings.push(`Se descartaron ${dangling} conexiones hacia módulos que no existen.`);
  return edges;
}

function readRange(value: unknown): { startLine: number; endLine: number } | null {
  if (!isRecord(value)) return null;
  const { startLine, endLine } = value;
  if (!isLine(startLine) || !isLine(endLine) || endLine < startLine) return null;
  return { startLine, endLine };
}

/** `.\src\a.py` o `./src/a.py` → `src/a.py`; rutas absolutas o con `..` no se aceptan. */
export function normalizePath(value: string): string | null {
  const path = value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..") ? path : null;
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1) || filePath;
}

function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
