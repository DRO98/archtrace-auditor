import {
  compareFindings,
  CRITICALITY_LABEL,
  type Criticality,
  type DiffSide,
  type Finding,
  type ReviewStatus,
} from "@core/audit";

export const REVIEW_LABEL: Readonly<Record<ReviewStatus, string>> = {
  pending: "Pendiente",
  reviewed: "Revisado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  false_positive: "Falso positivo",
};

/** Tono de las etiquetas del dashboard (`Badge`) por criticidad. */
export const CRITICALITY_TONE: Readonly<Record<Criticality, "rose" | "amber" | "sky" | "neutral" | "brand">> = {
  critical: "rose",
  high: "amber",
  medium: "sky",
  low: "neutral",
  unknown: "brand",
};

export { CRITICALITY_LABEL };

export type ReviewFilter = "all" | "pending" | Criticality;

/** Cola de revisión: criticidad, después confianza (mismo orden que `Auditoria.md`). */
export function reviewQueue(findings: readonly Finding[], filter: ReviewFilter = "all"): Finding[] {
  return findings
    .filter((finding) => {
      if (filter === "all") return true;
      if (filter === "pending") return finding.review.status === "pending";
      return finding.criticality === filter;
    })
    .sort(compareFindings);
}

export function stepIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

export type ReviewAction = { kind: "move"; delta: 1 | -1 } | { kind: "status"; status: ReviewStatus };

/** Atajos: j/k navegan, a/r/f/v marcan aceptado, rechazado, falso positivo y revisado. */
export function keyToAction(key: string): ReviewAction | null {
  switch (key) {
    case "j":
      return { kind: "move", delta: 1 };
    case "k":
      return { kind: "move", delta: -1 };
    case "a":
      return { kind: "status", status: "accepted" };
    case "r":
      return { kind: "status", status: "rejected" };
    case "f":
      return { kind: "status", status: "false_positive" };
    case "v":
      return { kind: "status", status: "reviewed" };
    default:
      return null;
  }
}

export interface LineDecoration {
  side: DiffSide;
  startLine: number;
  endLine: number;
  className: string;
  glyphClassName?: string;
  hover: string;
}

/**
 * Decoraciones del visor de diff para un hallazgo: el rango completo en tono suave y las líneas de evidencia
 * con glifo en el margen, cada una en su lado (head = modificado, base = original).
 */
export function decorationsFor(finding: Finding): LineDecoration[] {
  const tone = finding.criticality;
  const decorations: LineDecoration[] = [
    {
      side: finding.side,
      startLine: finding.lines.startLine,
      endLine: finding.lines.endLine,
      className: `audit-range audit-range-${tone}`,
      hover: `${finding.id} · ${CRITICALITY_LABEL[tone]}: ${finding.reason}`,
    },
  ];
  for (const item of finding.evidence) {
    decorations.push({
      side: item.side,
      startLine: item.line,
      endLine: item.line,
      className: `audit-evidence audit-evidence-${tone}`,
      glyphClassName: `audit-glyph audit-glyph-${tone}`,
      hover: `Evidencia (${item.source === "llm" ? "LLM" : "regla"}): ${item.text}`,
    });
  }
  return decorations;
}

/** Lenguaje de Monaco a partir de la extensión. */
export function monacoLanguage(file: string): string {
  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
    sh: "shell",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    php: "php",
  };
  if (file.split("/").pop()?.startsWith("Dockerfile")) return "dockerfile";
  return map[extension] ?? "plaintext";
}
