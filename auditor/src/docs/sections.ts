import type { LineRange } from "@core/protocol";
import { splitLines } from "../git/changes";

/** Frase de tipo regla dentro de una sección ("debe", "nunca", "must", "crítico"…). */
export interface DocRule {
  line: number;
  text: string;
  /** Marca el área como crítica o exige revisión humana: eleva el suelo hasta CRÍTICA. */
  critical: boolean;
}

export interface DocSection {
  /** `CLAUDE.md#autorizacion`: estable mientras no cambie el título. */
  id: string;
  file: string;
  headingPath: string[];
  level: number;
  lines: LineRange;
  text: string;
  rules: DocRule[];
}

/** Documentos de reglas y arquitectura que el auditor indexa. */
export function isRuleDocument(repoPath: string): boolean {
  const lower = repoPath.toLowerCase();
  const name = lower.split("/").pop() ?? "";
  if (name === "claude.md" || name === "agents.md" || name === ".cursorrules") return true;
  if (lower.startsWith(".cursor/rules/") && (name.endsWith(".mdc") || name.endsWith(".md"))) return true;
  if (lower.startsWith(".claude/") && name.endsWith(".md")) return true;
  if (lower.startsWith("docs/") && (name.endsWith(".md") || name.endsWith(".mdx"))) return true;
  return !lower.includes("/") && name.startsWith("readme");
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Normaliza para buscar sin acentos ni mayúsculas ("Crítico" → "critico"). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function slugify(text: string): string {
  return (
    fold(text)
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion"
  );
}

const RULE_MARKERS =
  /\b(must|must not|never|always|shall|required|requires?|mandatory|do not|don't|should not|forbidden|prohibited|only via|critical|debe|deben|debera|nunca|siempre|jamas|obligatori\w*|prohibid\w*|no se debe|no debe|solo (?:a traves|mediante|via)|critic\w*|requiere\w*|revision humana|necesita\w*|tiene(?:n)? que|hay que|needs? to|has to|have to)\b/;
const CRITICAL_MARKERS =
  /\b(critical|critic[oa]s?|requires? (?:a )?(?:human |manual )?review|requiere\w* (?:una )?revision|revision (?:humana|manual|obligatoria)|bloqueante|blocking|security[- ]sensitive)\b/;

/** Partición por encabezados markdown (fuera de bloques de código). El preámbulo es una sección propia. */
export function sectionize(file: string, text: string): DocSection[] {
  const lines = splitLines(text);
  let start = 0;
  // Front matter de `.mdc` / `.md`.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) start = end + 1;
  }
  const title = file.split("/").pop() ?? file;
  const sections: DocSection[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  const used = new Map<string, number>();
  let current: { level: number; headingPath: string[]; startLine: number; body: string[] } = {
    level: 0,
    headingPath: [title],
    startLine: start + 1,
    body: [],
  };
  let inFence = false;

  const flush = (endLine: number) => {
    const body = current.body.join("\n").trim();
    if (body.length === 0 && current.level === 0) return;
    const base = current.level === 0 ? "_" : slugify(current.headingPath[current.headingPath.length - 1] ?? "");
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const anchor = seen === 0 ? base : `${base}-${seen + 1}`;
    sections.push({
      id: `${file}#${anchor}`,
      file,
      headingPath: current.headingPath,
      level: current.level,
      lines: { startLine: current.startLine, endLine: Math.max(current.startLine, endLine) },
      text: current.body.join("\n").trim(),
      rules: extractRules(current.body, current.startLine + (current.level === 0 ? 0 : 1), current.headingPath),
    });
  };

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (!heading) {
      current.body.push(line);
      continue;
    }
    flush(index);
    const level = heading[1]!.length;
    const name = heading[2]!.trim();
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, title: name });
    current = { level, headingPath: stack.map((entry) => entry.title), startLine: index + 1, body: [] };
  }
  flush(lines.length);
  return sections;
}

/** Viñetas y frases que contienen marcadores de regla. Un título crítico ("Seguridad (crítico)") contagia a su cuerpo. */
function extractRules(body: readonly string[], firstLine: number, headingPath: readonly string[]): DocRule[] {
  const headingCritical = CRITICAL_MARKERS.test(fold(headingPath[headingPath.length - 1] ?? ""));
  const rules: DocRule[] = [];
  let inFence = false;
  body.forEach((raw, offset) => {
    if (FENCE.test(raw)) inFence = !inFence;
    if (inFence) return;
    const text = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (text.length < 8) return;
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿`*])/)) {
      const folded = fold(sentence);
      if (!RULE_MARKERS.test(folded)) continue;
      rules.push({ line: firstLine + offset, text: sentence.trim().slice(0, 400), critical: headingCritical || CRITICAL_MARKERS.test(folded) });
    }
  });
  return rules;
}
