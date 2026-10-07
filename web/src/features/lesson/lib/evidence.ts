import type { ProjectMap } from "@core/projectMap";
import type { AnswerEvidence } from "@/features/history/types";
import { checkCitation, parseMarkdown, type Block, type Inline } from "./markdown";

/**
 * Filtro de evidencia del chat: una respuesta que afirma cosas de ESTE proyecto tiene que citar código del mapa
 * (`ruta:línea` que exista). Lo decide el código, no el modelo: el modelo solo declara de qué tipo es su respuesta.
 */

/** Lo que el modelo declara en el campo `grounding` de su respuesta. */
export type Grounding = "project" | "theory" | "not-in-map";

export function isGrounding(value: unknown): value is Grounding {
  return value === "project" || value === "theory" || value === "not-in-map";
}

/** `ruta → nº de líneas`, lo que `checkCitation` necesita. */
export function mapLineCounts(map: ProjectMap): Map<string, number> {
  return new Map(map.files.map((file) => [file.filePath, file.lineCount]));
}

function inlinesOf(block: Block): Inline[] {
  if (block.type === "p" || block.type === "h") return block.inlines;
  if (block.type === "ul" || block.type === "ol") return block.items.flat();
  return [];
}

/** Citas `ruta:línea` que el panel mostraría como enlaces (las de bloques de código no cuentan). */
export function citationsIn(markdown: string): Array<Extract<Inline, { type: "cite" }>> {
  return parseMarkdown(markdown)
    .flatMap(inlinesOf)
    .filter((inline): inline is Extract<Inline, { type: "cite" }> => inline.type === "cite");
}

export function validCitationCount(markdown: string, files: ReadonlyMap<string, number>): number {
  return citationsIn(markdown).filter((cite) => checkCitation(cite, files) === "ok").length;
}

const PATH_LIKE = /(?:^|[\s`(])((?:[\w@.-]+\/)*[\w@-][\w@.-]*\.(?:py|pyi|ts|tsx|js|jsx|mjs|cjs|go|java|kt|rs|cs|rb|php))(?=$|[\s`),.:;])/;

/**
 * ¿Nombra archivos concretos? Rutas del mapa (completas o por nombre de archivo) o cualquier cosa con forma de ruta
 * de código: una teoría general no necesita hablar de `src/auth/service.ts`.
 */
export function mentionsCode(markdown: string, map: ProjectMap): boolean {
  return PATH_LIKE.test(markdown) || map.files.some((file) => markdown.includes(file.filePath));
}

/**
 * Veredicto sobre una respuesta ya generada:
 * - con alguna cita válida → `cited`;
 * - la respuesta admite que el mapa no lo muestra → `not-in-map`;
 * - teoría declarada que no nombra archivos → `theory`;
 * - todo lo demás (afirma cosas del proyecto, o nombra archivos, sin una sola cita válida) → `missing`.
 * Sin `grounding` (modelos que ignoran el esquema) se trata como proyecto solo si nombra archivos.
 */
export function assessEvidence(answer: string, grounding: Grounding | null, map: ProjectMap): AnswerEvidence {
  if (validCitationCount(answer, mapLineCounts(map)) > 0) return "cited";
  if (grounding === "not-in-map") return "not-in-map";
  if (grounding === "project") return "missing";
  return mentionsCode(answer, map) ? "missing" : "theory";
}

/** Nota para el reintento: qué falló y cómo corregirlo, sin reabrir la conversación entera. */
export function evidenceCorrection(previousAnswer: string): string {
  return `<rejected_answer>${previousAnswer.replace(/</g, "‹").replace(/>/g, "›")}</rejected_answer>
Your previous answer (above) was rejected: it makes claims about THIS project but contains no valid \`path:line\` citation from <project_map>.
Rewrite it. Every claim about this project must cite a path and line range copied exactly from <project_map>. If the map does not show what the question asks about, say so plainly in one sentence, point to the closest thing it does show (with its citation), and set "grounding" to "not-in-map". If the answer is purely general theory, drop the claims about the project and set "grounding" to "theory".`;
}
