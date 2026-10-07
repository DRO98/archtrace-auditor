/**
 * Markdown mínimo para las respuestas del mentor: párrafos, títulos, listas, bloques de código y de fórmulas
 * (```math), `código`, **negrita**, *cursiva* y citas `ruta:línea`. Produce datos, no HTML: el componente los pinta como
 * elementos React, así que el texto del modelo nunca se inyecta como marcado.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "cite"; raw: string; path: string; line: number; endLine: number | null };

export type Block =
  | { type: "p"; inlines: Inline[] }
  | { type: "h"; inlines: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][]; start?: number }
  | { type: "code"; text: string }
  /** Bloque ```math: fórmulas en notación Unicode, una por línea. */
  | { type: "math"; lines: string[] };

const CITE = /^((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,5}):(\d+)(?:[-–](\d+))?$/;
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])|((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,5}:\d+(?:[-–]\d+)?)/g;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```\s*([\w-]*)/;
const MATH_LANGS: ReadonlySet<string> = new Set(["math", "latex", "tex"]);

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: Extract<Block, { type: "ul" | "ol" }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "p", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (MATH_LANGS.has((fence[1] ?? "").toLowerCase())) {
        blocks.push({ type: "math", lines: code.map((item) => item.trim()).filter((item) => item.length > 0) });
      } else {
        blocks.push({ type: "code", text: code.join("\n") });
      }
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", inlines: parseInline(heading[1] ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(parseInline(bullet[1] ?? ""));
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ol") {
        flushList();
        // Los modelos separan a veces "1." y "2." con una línea en blanco: la lista nueva sigue la numeración escrita.
        list = { type: "ol", items: [], start: Number(ordered[1]) || 1 };
      }
      list.items.push(parseInline(ordered[2] ?? ""));
      continue;
    }
    if (list) flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    const [raw, code, strong, em, bare] = match;
    if (code !== undefined) out.push(citation(code) ?? { type: "code", text: code });
    else if (strong !== undefined) out.push({ type: "strong", text: strong });
    else if (em !== undefined) out.push({ type: "em", text: em });
    else if (bare !== undefined) out.push(citation(bare) ?? { type: "text", text: raw });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

function citation(raw: string): Inline | null {
  const match = CITE.exec(raw.trim());
  if (!match) return null;
  const line = Number(match[2]);
  const endLine = match[3] ? Number(match[3]) : null;
  return { type: "cite", raw: raw.trim(), path: match[1] ?? "", line, endLine };
}

export type CitationCheck = "ok" | "unknown-file" | "line-out-of-range" | "unchecked";

/** Contrasta una cita con el mapa (`ruta → nº de líneas`). Sin mapa cargado no se puede afirmar nada. */
export function checkCitation(
  cite: { path: string; line: number; endLine: number | null },
  files: ReadonlyMap<string, number> | null,
): CitationCheck {
  if (!files) return "unchecked";
  const lineCount = files.get(cite.path);
  if (lineCount === undefined) return "unknown-file";
  const end = cite.endLine ?? cite.line;
  return cite.line >= 1 && end >= cite.line && end <= lineCount ? "ok" : "line-out-of-range";
}
