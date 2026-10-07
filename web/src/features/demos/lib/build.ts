import type { CodeGraph, CodeModule, CodeSubBlock, EdgeKind, ModuleEdge, ModuleRole } from "@core/graph";
import type { FlowStep, StepMetrics } from "@core/simulation";
import { polyLanguageOf } from "@/lib/scan/polyScan";
import { ragStepMetrics } from "../../simulation/lib/metrics";

/**
 * Ayudantes para escribir las demos a mano sin repetir datos que el validador exige idénticos
 * (rangos de `fileReference` = rango del sub-bloque, ids de arista `imports:<origen>:<destino>`).
 */

export interface ModuleSpec {
  id: string;
  label: string;
  groupId: string;
  role: ModuleRole;
  /** Etapa de ejecución (0 entrada · 1 preproceso · 2 índice · 3 orquestación · 4 generación). */
  layer: number;
  summary: string;
  subsystem?: string;
  supportOf?: string;
  /** [nombre, línea inicial, línea final, resumen?]. Nombres únicos dentro del módulo. */
  blocks: ReadonlyArray<readonly [name: string, start: number, end: number, summary?: string]>;
}

function languageOf(filePath: string): string {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".ts")) return "typescript";
  return polyLanguageOf(filePath) ?? "text";
}

export function buildModule(spec: ModuleSpec): CodeModule {
  const subBlocks = spec.blocks.map(([name, startLine, endLine, summary]): CodeSubBlock => {
    const block: CodeSubBlock = {
      id: `${spec.id}::${name}`,
      kind: name.includes(".") ? "method" : /^[A-Z]/.test(name) ? "class" : "function",
      name,
      range: { startLine, endLine },
    };
    const parent = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : null;
    if (parent) block.parentId = `${spec.id}::${parent}`;
    if (summary) block.summary = summary;
    return block;
  });
  const codeModule: CodeModule = {
    id: spec.id,
    label: spec.label,
    filePath: spec.id,
    groupId: spec.groupId,
    language: languageOf(spec.id),
    role: spec.role,
    summary: spec.summary,
    subtitle: subBlocks.filter((block) => block.kind !== "method").slice(0, 3).map((block) => block.name).join(" · "),
    layer: spec.layer,
    subBlocks,
  };
  if (spec.subsystem) codeModule.subsystem = spec.subsystem;
  if (spec.supportOf) codeModule.supportOf = spec.supportOf;
  return codeModule;
}

export function edge(source: string, target: string, kind: EdgeKind = "imports", label: string = kind): ModuleEdge {
  return { id: `${kind}:${source}:${target}`, source, target, kind, label };
}

export interface StepSpec {
  nodeId: string;
  block: string;
  title: string;
  description: string;
  input: Record<string, unknown> | string;
  output: Record<string, unknown> | string;
  metrics?: StepMetrics;
  durationMs?: number;
}

/** Pasos de un escenario con `fileReference` tomado del sub-bloque real del grafo. */
export function buildSteps(graph: CodeGraph, specs: readonly StepSpec[]): FlowStep[] {
  const modules = new Map(graph.modules.map((item) => [item.id, item]));
  return specs.map((spec, stepIndex): FlowStep => {
    const owner = modules.get(spec.nodeId);
    const block = owner?.subBlocks.find((item) => item.name === spec.block);
    if (!owner || !block) throw new Error(`demo: ${spec.nodeId}::${spec.block} no existe en ${graph.projectName}`);
    const step: FlowStep = {
      stepIndex,
      nodeId: spec.nodeId,
      title: spec.title,
      description: spec.description,
      fileReference: {
        path: owner.filePath,
        lineStart: block.range.startLine,
        lineEnd: block.range.endLine,
        functionName: block.name,
      },
      mockPayload: { input: spec.input, output: spec.output },
    };
    if (spec.metrics) step.metrics = spec.metrics;
    if (spec.durationMs) step.durationMs = spec.durationMs;
    return step;
  });
}

/** Métricas RAG ilustrativas (tokens + relevancia). Para demos no-RAG usa `latency()`. */
export const metrics = ragStepMetrics;

/** Métricas genéricas: solo latencia y, opcionalmente, extensiones del perfil (lag, status…). */
export function latency(latencyMs: number, extensions?: Record<string, number>): StepMetrics {
  return extensions ? { latencyMs, extensions } : { latencyMs };
}
