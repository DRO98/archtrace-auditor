import type { DiffLine, FileChangeStatus } from "@core/audit";

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FilePatch {
  path: string;
  previousPath?: string;
  status: FileChangeStatus;
  binary: boolean;
  /** Blob SHA completos de la línea `index` (con `--full-index`). Ausentes si git no la emitió. */
  oldBlob?: string;
  newBlob?: string;
  untracked?: boolean;
  hunks: Hunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const INDEX = /^index ([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})/;
const ZERO = /^0+$/;

/**
 * Parser propio de `git diff` unificado (sin dependencias). Pensado para `-U0 --full-index -M` con prefijos
 * `a/` y `b/` explícitos; tolera contexto (`-U3`) y rutas entrecomilladas al estilo C.
 */
export function parseUnifiedDiff(stdout: string): FilePatch[] {
  const patches: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("diff --git ")) {
      current = { path: "", status: "modified", binary: false, hunks: [] };
      hunk = null;
      const fromHeader = parseDiffGitPaths(line.slice("diff --git ".length));
      if (fromHeader) {
        current.path = fromHeader.next;
        if (fromHeader.previous !== fromHeader.next) current.previousPath = fromHeader.previous;
      }
      patches.push(current);
      continue;
    }
    if (!current) continue;

    if (hunk) {
      const marker = line[0];
      if (marker === "+") {
        hunk.lines.push({ kind: "add", line: newLine, text: line.slice(1) });
        newLine += 1;
        continue;
      }
      if (marker === "-") {
        hunk.lines.push({ kind: "del", line: oldLine, text: line.slice(1) });
        oldLine += 1;
        continue;
      }
      if (marker === " ") {
        oldLine += 1;
        newLine += 1;
        continue;
      }
      if (marker === "\\") continue; // "\ No newline at end of file"
      if (line === "") continue;
      hunk = null;
    }

    const header = HUNK.exec(line);
    if (header) {
      hunk = {
        header: line,
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      current.hunks.push(hunk);
      continue;
    }
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename from ")) {
      current.previousPath = unquote(line.slice("rename from ".length));
      current.status = "renamed";
    } else if (line.startsWith("rename to ")) {
      current.path = unquote(line.slice("rename to ".length));
      current.status = "renamed";
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") current.binary = true;
    else if (line.startsWith("--- ")) {
      const name = stripPrefix(unquote(line.slice(4)), "a/");
      if (name !== null && current.status !== "renamed" && current.path === "") current.path = name;
    } else if (line.startsWith("+++ ")) {
      const name = stripPrefix(unquote(line.slice(4)), "b/");
      if (name !== null) current.path = name;
    } else {
      const index = INDEX.exec(line);
      if (index) {
        if (!ZERO.test(index[1]!)) current.oldBlob = index[1];
        if (!ZERO.test(index[2]!)) current.newBlob = index[2];
      }
    }
  }
  return patches.filter((patch) => patch.path.length > 0);
}

/** `a/x b/y` (o entrecomillado). Sin renombrado las dos mitades son iguales: se parte por la mitad. */
function parseDiffGitPaths(rest: string): { previous: string; next: string } | null {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest, 0);
    if (end < 0) return null;
    const previous = stripPrefix(unquote(rest.slice(0, end + 1)), "a/");
    const next = stripPrefix(unquote(rest.slice(end + 2)), "b/");
    return previous !== null && next !== null ? { previous, next } : null;
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start < 0) return null;
    const previous = stripPrefix(rest.slice(0, start), "a/");
    const next = stripPrefix(unquote(rest.slice(start + 1)), "b/");
    return previous !== null && next !== null ? { previous, next } : null;
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " ") {
    const previous = stripPrefix(rest.slice(0, half), "a/");
    const next = stripPrefix(rest.slice(half + 1), "b/");
    if (previous !== null && next !== null && previous === next) return { previous, next };
  }
  // Renombrado sin comillas: ` b/` es el separador más probable.
  const split = rest.indexOf(" b/");
  if (split < 0) return null;
  const previous = stripPrefix(rest.slice(0, split), "a/");
  const next = stripPrefix(rest.slice(split + 1), "b/");
  return previous !== null && next !== null ? { previous, next } : null;
}

function closingQuote(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index;
  }
  return -1;
}

function stripPrefix(name: string, prefix: string): string | null {
  const clean = name.replace(/\t$/, "");
  if (clean === "/dev/null") return null;
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

/** Comillas al estilo C de git: `"caf\303\251"` → `café` (los octales son bytes UTF-8). */
export function unquote(value: string): string {
  const text = value.replace(/\t$/, "");
  if (!(text.startsWith('"') && text.endsWith('"') && text.length >= 2)) return text;
  const bytes: number[] = [];
  const body = text.slice(1, -1);
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char !== "\\") {
      for (const byte of Buffer.from(char, "utf8")) bytes.push(byte);
      continue;
    }
    const next = body[index + 1] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(index + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      index += 3;
    } else if (next in simple) {
      bytes.push(simple[next]!);
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
