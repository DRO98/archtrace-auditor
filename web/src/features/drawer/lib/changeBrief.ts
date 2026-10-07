import type { UiLanguage } from "@/lib/i18n/lang";

/**
 * Brief de cambio acotado al subgrafo de impacto y su prompt para Cursor. Determinista, sin LLM: la plantilla
 * solo ordena lo que ya sabe el grafo (blast radius y quién llama al origen) para que el agente no se salga del área.
 */
export interface BriefModule {
  label: string;
  filePath: string;
}

export interface BriefInput {
  goal: string;
  origin: BriefModule;
  /** Aguas abajo del origen, con su distancia (1 = directo). */
  outgoing: ReadonlyArray<BriefModule & { depth: number }>;
  /** Quien llama al origen: depende de su contrato. */
  callers: readonly BriefModule[];
  riskLabel: string;
  /** Hallazgo del Architecture Check que motivó el brief. */
  finding?: { title: string; fixHint: string } | null;
  lang: UiLanguage;
}

/** Tope de rutas por sección: un prompt con 200 archivos deja de acotar nada. */
export const MAX_PATHS_PER_SECTION = 25;

export interface DepthCount {
  depth: number;
  count: number;
}

export function countByDepth(outgoing: ReadonlyArray<{ depth: number }>): DepthCount[] {
  const counts = new Map<number, number>();
  for (const item of outgoing) counts.set(item.depth, (counts.get(item.depth) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left - right).map(([depth, count]) => ({ depth, count }));
}

function pathList(items: readonly BriefModule[], lang: UiLanguage): string[] {
  const unique = [...new Map(items.map((item) => [item.filePath, item])).values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const lines = unique.slice(0, MAX_PATHS_PER_SECTION).map((item) => `- \`${item.filePath}\` (${item.label})`);
  const rest = unique.length - MAX_PATHS_PER_SECTION;
  if (rest > 0) lines.push(lang === "es" ? `- …y ${rest} más` : `- …and ${rest} more`);
  return lines;
}

const COPY = {
  en: {
    title: "Change brief",
    goalMissing: "(describe the change here)",
    target: "Target",
    risk: "Risk",
    impact: (direct: number, cascade: number, callers: number) => `${direct} direct, ${cascade} cascade, ${callers} caller${callers === 1 ? "" : "s"}`,
    context: "Architecture finding that motivated this change",
    fix: "Suggested fix",
    scope: "Scope — edit only these files",
    change: "Make the change here:",
    adapt: "Adapt if the change requires it (direct dependents):",
    verify: "Verify only; edit only if types or tests break (cascade):",
    contract: "Do not break — these call the target and depend on its contract",
    contractHint: "Keep the target's public signatures and data shapes backward compatible. If that is impossible, stop and list the required caller changes instead of editing them.",
    none: "- (none)",
    outOfScope: "Do not modify any file outside the lists above. If you think you must, stop and explain why first.",
    order: "Suggested order",
    steps: [
      "Read the target and its callers; restate the current contract in one sentence.",
      "Add or update tests for the target that pin the expected behaviour.",
      "Make the change in the target.",
      "Update direct dependents, one file at a time, running tests after each.",
      "Check the cascade files compile and their tests pass.",
      "Summarise what changed per file and anything you deliberately left untouched.",
    ],
  },
  es: {
    title: "Brief de cambio",
    goalMissing: "(describe aquí el cambio)",
    target: "Objetivo",
    risk: "Riesgo",
    impact: (direct: number, cascade: number, callers: number) =>
      `${direct} directo${direct === 1 ? "" : "s"}, ${cascade} en cascada, ${callers} consumidor${callers === 1 ? "" : "es"}`,
    context: "Hallazgo de arquitectura que motiva el cambio",
    fix: "Arreglo sugerido",
    scope: "Alcance — edita solo estos archivos",
    change: "Haz el cambio aquí:",
    adapt: "Adapta si el cambio lo exige (dependientes directos):",
    verify: "Solo verifica; edita únicamente si fallan tipos o tests (cascada):",
    contract: "No romper — llaman al objetivo y dependen de su contrato",
    contractHint: "Mantén compatibles las firmas públicas y la forma de los datos del objetivo. Si no es posible, para y enumera los cambios necesarios en los consumidores en vez de hacerlos.",
    none: "- (ninguno)",
    outOfScope: "No modifiques ningún archivo fuera de estas listas. Si crees que hace falta, para y explica por qué primero.",
    order: "Orden sugerido",
    steps: [
      "Lee el objetivo y sus consumidores; resume el contrato actual en una frase.",
      "Añade o ajusta tests del objetivo que fijen el comportamiento esperado.",
      "Haz el cambio en el objetivo.",
      "Actualiza los dependientes directos, de uno en uno, pasando los tests tras cada uno.",
      "Comprueba que los archivos en cascada compilan y sus tests pasan.",
      "Resume qué cambió en cada archivo y qué dejaste sin tocar a propósito.",
    ],
  },
} as const;

export function buildCursorPrompt(input: BriefInput): string {
  const copy = COPY[input.lang];
  const direct = input.outgoing.filter((item) => item.depth <= 1);
  const cascade = input.outgoing.filter((item) => item.depth > 1);
  const goal = input.goal.trim() || copy.goalMissing;
  const lines = [
    `# ${copy.title}: ${goal}`,
    "",
    `**${copy.target}:** \`${input.origin.filePath}\` (${input.origin.label})`,
    `**${copy.risk}:** ${input.riskLabel} — ${copy.impact(direct.length, cascade.length, input.callers.length)}`,
  ];
  if (input.finding) {
    lines.push("", `## ${copy.context}`, `- ${input.finding.title}`, `- ${copy.fix}: ${input.finding.fixHint}`);
  }
  lines.push(
    "",
    `## ${copy.scope}`,
    copy.change,
    `- \`${input.origin.filePath}\``,
    "",
    copy.adapt,
    ...(direct.length > 0 ? pathList(direct, input.lang) : [copy.none]),
  );
  if (cascade.length > 0) lines.push("", copy.verify, ...pathList(cascade, input.lang));
  lines.push(
    "",
    `## ${copy.contract}`,
    ...(input.callers.length > 0 ? pathList(input.callers, input.lang) : [copy.none]),
    copy.contractHint,
    "",
    copy.outOfScope,
    "",
    `## ${copy.order}`,
    ...copy.steps.map((step, index) => `${index + 1}. ${step}`),
  );
  return lines.join("\n");
}

/** Briefs recientes por grafo en `localStorage` (lista corta, los más nuevos primero). */
export const MAX_SAVED_BRIEFS = 8;

export interface SavedBrief {
  id: string;
  createdAt: number;
  goal: string;
  originId: string;
  originLabel: string;
  prompt: string;
}

export function briefsKey(graphName: string): string {
  return `archtrace.briefs:${graphName}`;
}

export function addBrief(list: readonly SavedBrief[], brief: SavedBrief): SavedBrief[] {
  // El mismo objetivo sobre el mismo módulo sustituye al anterior en vez de duplicarlo.
  const rest = list.filter((item) => !(item.originId === brief.originId && item.goal.trim() === brief.goal.trim()));
  return [brief, ...rest].slice(0, MAX_SAVED_BRIEFS);
}

export function parseBriefs(raw: string | null): SavedBrief[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedBrief =>
        typeof item === "object" && item !== null && typeof item.id === "string" && typeof item.prompt === "string" && typeof item.originId === "string",
    );
  } catch {
    return [];
  }
}
