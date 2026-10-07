/**
 * Nombres humanos de las partes de un repo, sin LLM: la carpeta humanizada (`parte1_gestos` → «Gestos») y, si el
 * README lo cuenta, su descripción. Se lee la tabla del README raíz que cita carpetas (`| 1 | Qué es | [`x/`](x/) |`)
 * y, en su defecto, el primer párrafo del README de cada carpeta.
 */

/** README raíz o de una carpeta de primer nivel (lo que describe las partes; los más hondos no se piden). */
export function isReadmePath(path: string): boolean {
  const segments = path.split("/");
  return segments.length <= 2 && /^readme\.(md|markdown|rst|txt)$/i.test(segments[segments.length - 1] ?? "");
}

const ACRONYMS = new Set(["api", "bff", "rag", "llm", "ui", "ux", "ml", "ai", "ia", "db", "etl", "sdk", "cli", "s3", "iot", "grpc", "http", "sql", "cdn", "mcp"]);
const ACCENTS: Readonly<Record<string, string>> = {
  integracion: "integración",
  configuracion: "configuración",
  documentacion: "documentación",
  aplicacion: "aplicación",
  autenticacion: "autenticación",
  administracion: "administración",
  simulacion: "simulación",
  comun: "común",
};

/** `parte1_gestos` → «Gestos», `parte3_chatbot_rag` → «Chatbot RAG», `02-data-platform` → «Data platform». */
export function humanizePart(folder: string): string {
  const stripped = folder.replace(/^(parte?|part|fase|phase|step|paso|modulo|module)[-_ ]?\d+[a-z]?[-_ ]*/i, "").replace(/^\d+[-_ ]+/, "");
  const words = (stripped.length > 0 ? stripped : folder)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s.]+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return ACCENTS[lower] ?? lower;
    });
  const label = words.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Quita enlaces, código en línea y énfasis de Markdown: `[`x/`](x/)` → `x/`. */
function plain(cell: string): string {
  return cell
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Carpeta citada en una celda (`parte1_gestos/`, `./apps/web`), o null. */
function folderIn(cell: string, folders: ReadonlySet<string>): string | null {
  const raw = cell.match(/\(([^)]+)\)/)?.[1] ?? plain(cell);
  const first = raw.replace(/^\.\//, "").split("/")[0]?.trim() ?? "";
  return folders.has(first) ? first : null;
}

/**
 * Tablas del README raíz: fila que cita una carpeta existente → la celda de texto más larga de esa fila.
 * `folders` son las carpetas de primer nivel del grafo (así una URL con `8002/docs` no cuenta como carpeta).
 */
export function readmePartDescriptions(readme: string, folders: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of readme.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^\|[\s:|-]+\|?$/.test(trimmed)) continue;
    const cells = trimmed.replace(/^\||\|$/g, "").split("|");
    let folder: string | null = null;
    let folderCell = -1;
    cells.forEach((cell, index) => {
      if (folder) return;
      folder = folderIn(cell, folders);
      if (folder) folderCell = index;
    });
    if (!folder || found.has(folder)) continue;
    const description = cells
      .filter((_, index) => index !== folderCell)
      .map(plain)
      .filter((cell) => /\p{L}{3}/u.test(cell))
      .sort((left, right) => right.length - left.length)[0];
    if (description) found.set(folder, description);
  }
  return found;
}

/** Primer párrafo de prosa de un README (sin títulos, insignias, tablas ni bloques de código), en una frase. */
export function readmeSummary(readme: string): string | null {
  let fenced = false;
  const paragraph: string[] = [];
  for (const line of readme.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const skip = trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.startsWith(">") || trimmed.startsWith("<") || /^(!\[|\[!\[)/.test(trimmed);
    if (trimmed.length === 0 || skip) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  const text = plain(paragraph.join(" ")).replace(/\s+/g, " ");
  if (text.length < 12) return null;
  const sentence = /^(.{12,}?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > 180 ? `${sentence.slice(0, 177).trimEnd()}…` : sentence;
}

const MAX_SHORT_LABEL = 26;

/**
 * Título corto a partir de la descripción («Chatbot RAG: LangChain + Qdrant…» → «Chatbot RAG»). null si no sale
 * algo breve: entonces manda la carpeta humanizada.
 */
export function shortPartLabel(description: string): string | null {
  const head = description.split(/\s*(?::|\(|—|–| - |,|;|\.\s| con | with | que | that | para | for )\s*/i)[0]?.trim() ?? "";
  if (head.length < 3 || head.length > MAX_SHORT_LABEL) return null;
  return head.charAt(0).toUpperCase() + head.slice(1);
}
