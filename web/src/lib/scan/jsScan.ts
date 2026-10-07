/**
 * Escáner ligero de JS/TS (sin compilador): bloques de nivel superior e imports relativos.
 * Pensado para el navegador; es heurístico, igual que `pyScan`.
 */

export interface ScriptBlock {
  name: string;
  kind: "class" | "function";
  startLine: number;
  endLine: number;
}

const BLOCK_PATTERNS: readonly { kind: ScriptBlock["kind"]; re: RegExp }[] = [
  { kind: "class", re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  {
    kind: "function",
    re: /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  },
];

/** Bloques declarados en la columna 0. Cada uno acaba donde empieza el siguiente (o al final del archivo). */
export function scanScriptSource(source: string): ScriptBlock[] {
  const lines = source.split(/\r?\n/);
  const starts: { name: string; kind: ScriptBlock["kind"]; line: number }[] = [];
  lines.forEach((line, index) => {
    if (line.length === 0 || line[0] === " " || line[0] === "\t") return;
    for (const { kind, re } of BLOCK_PATTERNS) {
      const match = line.match(re);
      if (match?.[1]) {
        starts.push({ name: match[1], kind, line: index + 1 });
        return;
      }
    }
  });
  let last = lines.length;
  while (last > 1 && (lines[last - 1] ?? "").trim() === "") last -= 1;
  return starts.map((start, index) => {
    const next = starts[index + 1];
    let end = next ? next.line - 1 : last;
    while (end > start.line && (lines[end - 1] ?? "").trim() === "") end -= 1;
    return { name: start.name, kind: start.kind, startLine: start.line, endLine: end };
  });
}

const IMPORT_RES: readonly RegExp[] = [
  /\bimport\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function normalize(parts: string[]): string | null {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function candidates(base: string): string[] {
  // `./x.js` en TS con ESM apunta a `x.ts`.
  const stripped = base.replace(/\.(m|c)?jsx?$/, "");
  return [
    base,
    ...EXTENSIONS.map((ext) => `${stripped}${ext}`),
    ...EXTENSIONS.map((ext) => `${stripped}/index${ext}`),
  ];
}

function resolveSpec(spec: string, filePath: string, known: ReadonlySet<string>): string | null {
  let base: string | null;
  if (spec.startsWith(".")) {
    const dir = filePath.split("/").slice(0, -1);
    base = normalize([...dir, ...spec.split("/")]);
  } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
    base = `src/${spec.slice(2)}`;
  } else if (spec.startsWith("/")) {
    base = normalize(spec.split("/"));
  } else {
    return null;
  }
  if (base === null) return null;
  return candidates(base).find((candidate) => known.has(candidate)) ?? null;
}

/** Archivos del repo que importa `filePath` (solo relativos o con alias `@/`), ordenados. */
export function resolveScriptImports(source: string, filePath: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const re of IMPORT_RES) {
    for (const match of source.matchAll(re)) {
      const resolved = match[1] ? resolveSpec(match[1], filePath, known) : null;
      if (resolved && resolved !== filePath) found.add(resolved);
    }
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}
