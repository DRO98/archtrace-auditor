"use client";

import { useEffect, useMemo, useState } from "react";
import { getViewportForBounds, useStore, type Edge, type ReactFlowInstance } from "@xyflow/react";
import type { CodeGraph } from "@core/graph";
import type { ExecutionFlowScenario } from "@core/simulation";
import { toPng, toSvg } from "html-to-image";
import { Check, Copy, Download, X } from "lucide-react";
import { downloadText, downloadUrl } from "@/lib/download";
import { createZip, dataUrlToBytes, type ZipEntry } from "@/lib/zip";
import { sessionLesson } from "@/features/history/lib/sessionNode";
import type { LessonSession } from "@/features/history/types";
import { useLessonStore } from "@/features/lesson/store";
import { useSimStore } from "@/features/simulation/store";
import { useCanvasStore } from "../store";
import { applyCanvasEdits } from "../edit/components";
import { notesMarkdown, type NotesByNode } from "../edit/notes";
import { useCanvasEdits } from "../edit/store";
import { isSubsystemNode, type AppFlowNode } from "../lib/flow";
import {
  ARCHITECTURE_DOC_FILENAME,
  generateArchitectureMarkdown,
  generateMermaidGraph,
  type MermaidEdge,
  type MermaidNode,
} from "../lib/mermaidExporter";

/** Formatos de texto: cada uno abre su propio modal. La imagen se descarga directamente, sin modal. */
export type ExportFormat = "markdown" | "mermaid";

const TITLES: Record<ExportFormat, string> = {
  markdown: "Documentación Markdown",
  mermaid: "Código Mermaid.js",
};

const CANVAS_BG = "#f8fafc";

function toMermaidNode(node: AppFlowNode): MermaidNode {
  if (isSubsystemNode(node)) return { id: node.id, type: node.type, data: { label: node.data.label } };
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    data: { role: node.data.role, module: { label: node.data.module.label, role: node.data.role } },
  };
}

function lessonsByModule(sessions: readonly LessonSession[], current: LessonSession | null): Map<string, string> {
  const map = new Map<string, string>();
  const ordered = current ? [current, ...sessions] : [...sessions];
  for (const session of ordered) {
    if (!session.nodeId || map.has(session.nodeId)) continue;
    const overview = sessionLesson(session)?.overview;
    if (overview) map.set(session.nodeId, overview);
  }
  return map;
}

/** Módulo → nombre de la caja (subsistema) que lo contiene en el lienzo. */
function subsystemsOf(nodes: readonly AppFlowNode[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of nodes) if (isSubsystemNode(node)) labels.set(node.id, node.data.label);
  const map = new Map<string, string>();
  for (const node of nodes) {
    const label = node.parentId ? labels.get(node.parentId) : undefined;
    if (label && !isSubsystemNode(node)) map.set(node.id, label);
  }
  return map;
}

export interface ArchitectureDocsInput {
  graph: CodeGraph;
  nodes: readonly AppFlowNode[];
  edges: readonly Pick<Edge, "id" | "source" | "target">[];
  sessions: readonly LessonSession[];
  session: LessonSession | null;
  scenarios: readonly ExecutionFlowScenario[];
  /** Notas de arquitectura por nodo (estado del proyecto): se añaden como sección al final. */
  notes?: NotesByNode;
}

/** Mermaid + ARCHITECTURE.md del lienzo tal como se ve (lo comparten el modal y el export Zip). */
export function buildArchitectureDocs(input: ArchitectureDocsInput): { mermaid: string; markdown: string } {
  const kindById = new Map(input.graph.edges.map((edge) => [edge.id, edge.kind]));
  const mermaidEdges = input.edges.map((edge): MermaidEdge => ({ id: edge.id, source: edge.source, target: edge.target, kind: kindById.get(edge.id) }));
  const mermaid = generateMermaidGraph(input.nodes.map(toMermaidNode), mermaidEdges);
  const base = generateArchitectureMarkdown(input.graph, mermaid, lessonsByModule(input.sessions, input.session), {
    scenarios: input.scenarios,
    subsystemByModuleId: subsystemsOf(input.nodes),
  });
  const labels = new Map(input.graph.modules.map((item) => [item.id, item.label]));
  const notes = input.notes ? notesMarkdown(input.notes, (id) => labels.get(id) ?? id) : "";
  return { mermaid, markdown: notes ? `${base.trimEnd()}

${notes}` : base };
}

/** Nombre de archivo a partir del nombre del proyecto. */
export function projectSlug(projectName: string | undefined): string {
  return (
    (projectName ?? "arquitectura").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "arquitectura"
  );
}

/** Margen alrededor del plano general exportado, en px del lienzo. */
const EXPORT_PADDING = 48;
/** Chrome/Safari no pintan canvas de más de ~16k px por lado: se baja la resolución si hace falta. */
const MAX_CANVAS_SIDE = 16_000;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Exporta el plano general: TODA la arquitectura, no solo la parte visible. Como el lienzo usa
 * `onlyRenderVisibleElements`, primero se encuadra todo (`fitView`) para que React Flow monte cada
 * nodo y arista; después se captura el viewport con un `transform` calculado a partir de
 * `getNodesBounds` + `getViewportForBounds` a escala 1 (×2 de resolución), y se restaura la vista.
 */
export async function exportViewport(kind: "png" | "svg", filename: string, flow: ReactFlowInstance<AppFlowNode>): Promise<void> {
  downloadUrl(filename, await captureViewport(kind, flow));
}

/** Captura el plano general como data URL (PNG o SVG), sin descargarlo. Ver `exportViewport`. */
export async function captureViewport(kind: "png" | "svg", flow: ReactFlowInstance<AppFlowNode>): Promise<string> {
  const viewport = document.querySelector(".react-flow__viewport");
  if (!(viewport instanceof HTMLElement)) throw new Error("No se encontró el lienzo.");
  const nodes = flow.getNodes().filter((node) => !node.hidden);
  if (nodes.length === 0) throw new Error("No hay nodos que exportar.");

  const saved = flow.getViewport();
  try {
    await flow.fitView({ padding: 0.05, duration: 0 });
    // Dos frames: uno para que React monte los nodos que estaban fuera de pantalla y otro para medirlos/pintarlos.
    await nextFrame();
    await nextFrame();

    const bounds = flow.getNodesBounds(nodes);
    const width = Math.ceil(bounds.width + EXPORT_PADDING * 2);
    const height = Math.ceil(bounds.height + EXPORT_PADDING * 2);
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, `${EXPORT_PADDING}px`);
    const pixelRatio = Math.max(0.5, Math.min(2, MAX_CANVAS_SIDE / Math.max(width, height)));
    const options = {
      backgroundColor: CANVAS_BG,
      width,
      height,
      pixelRatio,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    };
    return kind === "png" ? await toPng(viewport, options) : await toSvg(viewport, options);
  } finally {
    await flow.setViewport(saved, { duration: 0 });
  }
}

/**
 * Paquete Zip de documentación: ARCHITECTURE.md, el Mermaid, PNG y SVG del plano general y los escenarios
 * de simulación (JSON). Si una imagen no se puede capturar, el zip sale igual sin ella.
 */
export async function exportDocsZip(
  input: ArchitectureDocsInput,
  flow: ReactFlowInstance<AppFlowNode>,
): Promise<{ filename: string; missing: string[] }> {
  const slug = projectSlug(input.graph.projectName);
  const { mermaid, markdown } = buildArchitectureDocs(input);
  const entries: ZipEntry[] = [
    { name: ARCHITECTURE_DOC_FILENAME, data: markdown },
    { name: `${slug}-architecture.mmd`, data: mermaid },
  ];
  if (input.scenarios.length > 0) {
    entries.push({ name: "scenarios.json", data: JSON.stringify({ version: 1, graph: slug, scenarios: input.scenarios }, null, 2) });
  }
  const missing: string[] = [];
  for (const kind of ["png", "svg"] as const) {
    try {
      entries.push({ name: `${slug}.${kind}`, data: dataUrlToBytes(await captureViewport(kind, flow)) });
    } catch (error) {
      console.error(`[teacher] zip: no se pudo capturar ${kind}`, error);
      missing.push(kind.toUpperCase());
    }
  }
  const zip = createZip(entries);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  const filename = `${slug}-docs.zip`;
  try {
    downloadUrl(filename, url);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { filename, missing };
}

export function ExportDocsModal({ format, onClose }: { format: ExportFormat; onClose: () => void }) {
  const storeGraph = useCanvasStore((state) => state.graph);
  const components = useCanvasEdits((state) => state.components);
  // El documento describe lo que se ve: incluye los componentes añadidos en el lienzo.
  const graph = useMemo(() => (storeGraph ? applyCanvasEdits(storeGraph, components) : null), [storeGraph, components]);
  const nodes = useStore((state) => state.nodes as AppFlowNode[]);
  const edges = useStore((state) => state.edges);
  const sessions = useLessonStore((state) => state.sessions);
  const session = useLessonStore((state) => state.session);
  const scenarios = useSimStore((state) => state.scenarios);
  const notes = useCanvasEdits((state) => state.notes);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mermaid, markdown } = useMemo(
    () => (graph ? buildArchitectureDocs({ graph, nodes, edges, sessions, session, scenarios, notes }) : { mermaid: "", markdown: "" }),
    [graph, nodes, edges, sessions, session, scenarios, notes],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const slug = projectSlug(graph?.projectName);

  async function copy(text: string): Promise<void> {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("El navegador no permitió copiar al portapapeles. Usa el botón de descarga.");
    }
  }

  const text = format === "mermaid" ? mermaid : markdown;
  const textFile =
    format === "mermaid"
      ? { name: `${slug}-architecture.mmd`, mime: "text/plain", hint: "Pégalo en un bloque ```mermaid de GitHub o en un bloque Mermaid de Notion." }
      : { name: ARCHITECTURE_DOC_FILENAME, mime: "text/markdown", hint: "Diagrama Mermaid, desglose de componentes, rutas de API, dependencias detectadas y flujo de datos. Listo para la raíz del repositorio." };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[format]}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-white shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{TITLES[format]}</h2>
          <button
            type="button"
            aria-label="Cerrar exportación"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              <span className="font-mono text-xs text-ink">{textFile.name}</span> · {textFile.hint}
            </p>
            <pre
              tabIndex={0}
              aria-label={`Vista previa de ${textFile.name}`}
              className="max-h-96 overflow-auto rounded-lg border border-line bg-neutral-50 p-3 font-mono text-xs leading-5 text-ink"
            >
              {text}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!text}
                onClick={() => downloadText(textFile.name, text, textFile.mime)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                <Download className="size-4" aria-hidden />
                Descargar {textFile.name}
              </button>
              <button
                type="button"
                disabled={!text}
                onClick={() => void copy(text)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-neutral-50 disabled:opacity-50"
              >
                {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copiado" : format === "mermaid" ? "Copiar código Mermaid" : "Copiar Markdown"}
              </button>
            </div>
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
