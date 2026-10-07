import type { CodeGraph, CodeModule, EdgeKind, ModuleEdge, ModuleRole } from "@core/graph";
import type { ExecutionFlowScenario } from "@core/simulation";
import { detectApiRoutes, detectTechnologies, languageBreakdown } from "./architectureFacts";

export interface MermaidNode {
  id: string;
  type?: string;
  parentId?: string;
  data: {
    label?: string;
    role?: string;
    module?: { label: string; role?: string };
  };
}

export interface MermaidEdge {
  id: string;
  source: string;
  target: string;
  /** Tipo de la dependencia; sin él se dibuja como `imports`. */
  kind?: EdgeKind;
}

/** Nombre del archivo de documentación que se descarga. */
export const ARCHITECTURE_DOC_FILENAME = "ARCHITECTURE.md";

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "#quot;").replace(/\]/g, "#93;").replace(/\r?\n/g, " ");
}

function nodeLabel(node: MermaidNode): string {
  if (node.type === "subsystem") return node.data.label ?? node.id;
  const label = node.data.module?.label ?? node.data.label ?? node.id;
  const role = node.data.role ?? node.data.module?.role;
  return role ? `${label} (${role})` : label;
}

/** Colores por rol, legibles en el tema claro y oscuro de GitHub y en Notion. */
const ROLE_STYLES: Readonly<Record<string, string>> = {
  api: "fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e",
  app: "fill:#ffe4e6,stroke:#e11d48,color:#881337",
  ui: "fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e",
  pipeline: "fill:#ede9fe,stroke:#7c3aed,color:#4c1d95",
  service: "fill:#ede9fe,stroke:#7c3aed,color:#4c1d95",
  transform: "fill:#f5f3ff,stroke:#8b5cf6,color:#4c1d95",
  database: "fill:#d1fae5,stroke:#059669,color:#064e3b",
  "ai-model": "fill:#fef3c7,stroke:#d97706,color:#78350f",
  prompt: "fill:#fef9c3,stroke:#ca8a04,color:#713f12",
};

function roleClass(role: string): string {
  return `role_${role.replace(/[^a-z0-9]/gi, "_")}`;
}

function arrow(kind: EdgeKind | undefined): string {
  if (kind === "calls") return "-->|calls|";
  if (kind === "data-flow") return "-.->|datos|";
  return "-->";
}

/**
 * Serializa el lienzo a `graph TD` (se pega tal cual en un README de GitHub o en un bloque Mermaid de Notion).
 * Los ids con `/`, `.` o `:` se aliasan (`n0`, `n1`…). Las aristas `support:` son anclaje visual y no entran.
 */
export function generateMermaidGraph(nodes: readonly MermaidNode[], edges: readonly MermaidEdge[]): string {
  const alias = new Map<string, string>();
  nodes.forEach((node, index) => {
    alias.set(node.id, `n${index}`);
  });

  const childrenOf = new Map<string, MermaidNode[]>();
  const roots: MermaidNode[] = [];
  for (const node of nodes) {
    if (node.parentId && alias.has(node.parentId)) {
      const list = childrenOf.get(node.parentId);
      if (list) list.push(node);
      else childrenOf.set(node.parentId, [node]);
    } else if (node.type !== "subsystem") {
      roots.push(node);
    }
  }

  const lines: string[] = ["graph TD"];
  const byRole = new Map<string, string[]>();
  const emitNode = (node: MermaidNode, indent: string) => {
    const id = alias.get(node.id);
    if (!id) return;
    lines.push(`${indent}${id}["${escapeLabel(nodeLabel(node))}"]`);
    const role = node.data.role ?? node.data.module?.role;
    if (role && ROLE_STYLES[role]) byRole.set(role, [...(byRole.get(role) ?? []), id]);
  };

  for (const node of nodes) {
    if (node.type !== "subsystem") continue;
    const id = alias.get(node.id);
    if (!id) continue;
    lines.push(`  subgraph ${id}["${escapeLabel(nodeLabel(node))}"]`);
    for (const child of childrenOf.get(node.id) ?? []) emitNode(child, "    ");
    lines.push("  end");
  }
  for (const node of roots) emitNode(node, "  ");

  for (const edge of edges) {
    if (edge.id.startsWith("support:")) continue;
    const source = alias.get(edge.source);
    const target = alias.get(edge.target);
    if (!source || !target || source === target) continue;
    lines.push(`  ${source} ${arrow(edge.kind)} ${target}`);
  }

  for (const [role, ids] of byRole) {
    lines.push(`  classDef ${roleClass(role)} ${ROLE_STYLES[role]}`);
    lines.push(`  class ${ids.join(",")} ${roleClass(role)}`);
  }

  return lines.join("\n");
}

const ROLE_LABELS: Readonly<Record<ModuleRole, string>> = {
  api: "Entrada / API",
  app: "Arranque de la aplicación",
  ui: "Interfaz",
  pipeline: "Orquestador",
  service: "Servicio",
  transform: "Transformación de datos",
  database: "Almacenamiento",
  cache: "Caché",
  broker: "Broker de mensajes",
  stream: "Procesado de streams",
  rpc: "RPC",
  "ai-model": "Modelo de IA",
  prompt: "Prompt",
  util: "Utilidad",
  code: "Código",
};

const EDGE_KIND_LABELS: Readonly<Record<EdgeKind, string>> = {
  imports: "importa",
  calls: "llama a",
  "data-flow": "envía datos a",
};

function moduleDescription(summary: string | undefined, subtitle: string | undefined, lesson: string | undefined): string {
  const base = summary?.trim() || subtitle?.trim() || "Sin descripción en el mapa.";
  if (!lesson?.trim()) return base;
  return `${base} ${lesson.trim()}`;
}

/** Ancla estilo GitHub: minúsculas, sin signos, espacios → guiones. */
function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export interface ArchitectureMarkdownOptions {
  /** Escenarios de simulación: si hay, documentan el flujo de datos paso a paso. */
  scenarios?: readonly ExecutionFlowScenario[];
  /** Subsistema (caja del lienzo) de cada módulo, por id. */
  subsystemByModuleId?: ReadonlyMap<string, string>;
  generatedAt?: Date;
}

function dependencyLine(edge: ModuleEdge, other: CodeModule | undefined, otherId: string): string {
  const name = other ? `[${other.label}](#${anchorOf(other.label)})` : `\`${otherId}\``;
  return `${name} _(${EDGE_KIND_LABELS[edge.kind] ?? edge.kind})_`;
}

function dataFlowSection(graph: CodeGraph, byId: ReadonlyMap<string, CodeModule>, scenarios: readonly ExecutionFlowScenario[]): string[] {
  const lines = ["## Flujo de datos", ""];
  if (scenarios.length > 0) {
    for (const scenario of scenarios) {
      lines.push(`### ${scenario.name}`, "", scenario.description, "");
      scenario.steps.forEach((step, index) => {
        const owner = byId.get(step.nodeId);
        const where = `${owner?.label ?? step.nodeId} · \`${step.fileReference.functionName}\``;
        lines.push(`${index + 1}. **${step.title}** — ${where}. ${step.description}`);
      });
      const path = scenario.steps.map((step) => byId.get(step.nodeId)?.label ?? step.nodeId);
      lines.push("", `Recorrido: ${path.join(" → ")}`, "");
    }
    return lines;
  }
  // Sin escenarios: el orden de ejecución que fija el mapa (capa 0 = entrada).
  const ordered = [...graph.modules].sort((left, right) => (left.layer ?? 99) - (right.layer ?? 99));
  lines.push("Orden de ejecución según el mapa (de la entrada a la generación):", "");
  ordered.forEach((item, index) => {
    const next = graph.edges.filter((edge) => edge.source === item.id).map((edge) => byId.get(edge.target)?.label ?? edge.target);
    lines.push(`${index + 1}. **${item.label}**${next.length > 0 ? ` → ${next.join(", ")}` : ""}`);
  });
  lines.push("");
  return lines;
}

/**
 * `ARCHITECTURE.md`: visión general, diagrama Mermaid, desglose de componentes, rutas de API mapeadas,
 * dependencias detectadas (tecnologías externas y entre módulos), detalle por módulo y flujo de datos.
 */
export function generateArchitectureMarkdown(
  graph: CodeGraph,
  mermaid: string,
  lessonsByModuleId: ReadonlyMap<string, string>,
  options: ArchitectureMarkdownOptions = {},
): string {
  const byId = new Map(graph.modules.map((item) => [item.id, item]));
  const edges = graph.edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target) && edge.source !== edge.target);
  const subsystems = options.subsystemByModuleId ?? new Map<string, string>();
  const scenarios = options.scenarios ?? [];
  const date = (options.generatedAt ?? new Date()).toISOString().slice(0, 10);

  const subsystemGroups = new Map<string, string[]>();
  for (const item of graph.modules) {
    const name = subsystems.get(item.id);
    if (name) subsystemGroups.set(name, [...(subsystemGroups.get(name) ?? []), item.label]);
  }

  const overview = [
    "## Visión general",
    "",
    `- **Módulos:** ${graph.modules.length}`,
    `- **Dependencias:** ${edges.length}`,
    ...(subsystemGroups.size > 0 ? [`- **Subsistemas:** ${subsystemGroups.size}`] : []),
    ...(scenarios.length > 0 ? [`- **Flujos documentados:** ${scenarios.map((item) => item.name).join(", ")}`] : []),
    "",
    ...(subsystemGroups.size > 0
      ? ["| Subsistema | Módulos |", "|---|---|", ...[...subsystemGroups].map(([name, labels]) => `| ${cell(name)} | ${cell(labels.join(", "))} |`), ""]
      : []),
  ];

  const modules = graph.modules.map((item) => {
    const outgoing = edges.filter((edge) => edge.source === item.id);
    const incoming = edges.filter((edge) => edge.target === item.id);
    const blocks = item.subBlocks.filter((block) => !block.parentId).slice(0, 8);
    const facts = [
      `- **Archivo:** \`${item.filePath}\``,
      ...(item.role ? [`- **Rol:** ${ROLE_LABELS[item.role] ?? item.role}`] : []),
      ...(subsystems.get(item.id) ? [`- **Subsistema:** ${subsystems.get(item.id)}`] : []),
    ];
    return [
      `### ${item.label}`,
      "",
      moduleDescription(item.summary, item.subtitle, lessonsByModuleId.get(item.id)),
      "",
      ...facts,
      `- **Depende de:** ${outgoing.length > 0 ? outgoing.map((edge) => dependencyLine(edge, byId.get(edge.target), edge.target)).join(", ") : "—"}`,
      `- **Usado por:** ${incoming.length > 0 ? incoming.map((edge) => dependencyLine(edge, byId.get(edge.source), edge.source)).join(", ") : "— (punto de entrada)"}`,
      ...(blocks.length > 0
        ? ["", "Componentes clave:", "", ...blocks.map((block) => `- \`${block.name}\` (L${block.range.startLine}–${block.range.endLine})${block.summary ? ` — ${block.summary}` : ""}`)]
        : []),
    ].join("\n");
  });

  const code = (value: string): string => `\`${cell(value)}\``;

  const componentTable = [
    "## Desglose de componentes",
    "",
    "| Componente | Rol | Archivo | Subsistema | Entradas | Salidas |",
    "|---|---|---|---|---|---|",
    ...graph.modules.map((item) => {
      const role = item.role ? (ROLE_LABELS[item.role] ?? item.role) : "—";
      const file = item.language === "virtual" ? "_propuesto en el lienzo_" : code(item.filePath);
      const inputs = edges.filter((edge) => edge.target === item.id).length;
      const outputs = edges.filter((edge) => edge.source === item.id).length;
      return `| [${cell(item.label)}](#${anchorOf(item.label)}) | ${cell(role)} | ${file} | ${cell(subsystems.get(item.id) ?? "—")} | ${inputs} | ${outputs} |`;
    }),
    "",
  ];

  const routes = detectApiRoutes(graph);
  const routeSection = [
    "## Rutas de API",
    "",
    ...(routes.length === 0
      ? ["No se detectaron rutas de API (ni `app/**/route.ts`, ni `pages/api/**`, ni módulos con rol API).", ""]
      : [
          "Detectadas a partir de las rutas de archivo (Next.js App Router y `pages/api`) y de los handlers de los módulos de API.",
          "",
          "| Método | Ruta | Handler | Archivo |",
          "|---|---|---|---|",
          ...routes.map(
            (route) =>
              `| ${code(route.method)} | ${route.path === "—" ? "—" : code(route.path)} | ${code(route.handler)} | ${code(`${route.filePath}${route.line ? `:${route.line}` : ""}`)} |`,
          ),
          "",
        ]),
  ];

  const technologies = detectTechnologies(graph);
  const languages = languageBreakdown(graph);
  const dependencySection = [
    "## Dependencias detectadas",
    "",
    ...(languages.length > 0 ? [`**Lenguajes:** ${languages.map((item) => `${item.language} (${item.modules})`).join(", ")}`, ""] : []),
    "### Tecnologías y servicios externos",
    "",
    ...(technologies.length === 0
      ? ["No se detectaron tecnologías externas por nombre en rutas, etiquetas o símbolos.", ""]
      : [
          "| Tecnología | Categoría | Módulos |",
          "|---|---|---|",
          ...technologies.map((tech) => `| ${cell(tech.name)} | ${cell(tech.category)} | ${cell(tech.modules.join(", "))} |`),
          "",
        ]),
    "### Entre módulos",
    "",
    ...(edges.length === 0
      ? ["El grafo no tiene dependencias entre módulos.", ""]
      : [
          "| Origen | Destino | Tipo |",
          "|---|---|---|",
          ...edges.map((edge) => `| ${cell(byId.get(edge.source)?.label ?? edge.source)} | ${cell(byId.get(edge.target)?.label ?? edge.target)} | ${edge.kind} |`),
          "",
        ]),
  ];

  return [
    `# ${graph.projectName} — Arquitectura`,
    "",
    `> Documentación generada con ArchTrace el ${date}. El diagrama usa Mermaid: GitHub y Notion lo renderizan directamente.`,
    "",
    "## Índice",
    "",
    "- [Visión general](#visión-general)",
    "- [Diagrama](#diagrama)",
    "- [Desglose de componentes](#desglose-de-componentes)",
    "- [Rutas de API](#rutas-de-api)",
    "- [Dependencias detectadas](#dependencias-detectadas)",
    "- [Módulos](#módulos)",
    "- [Flujo de datos](#flujo-de-datos)",
    "",
    ...overview,
    "## Diagrama",
    "",
    "```mermaid",
    mermaid,
    "```",
    "",
    ...componentTable,
    ...routeSection,
    ...dependencySection,
    "## Módulos",
    "",
    modules.join("\n\n"),
    "",
    ...dataFlowSection(graph, byId, scenarios),
  ].join("\n");
}
