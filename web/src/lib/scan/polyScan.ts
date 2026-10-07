/**
 * Escáner ligero (sin AST) para stacks JVM (Java, Kotlin, Scala), Go y contratos Protobuf: bloques de
 * nivel superior e imports resueltos contra los archivos del repo. Heurístico, como `pyScan`/`jsScan`:
 * sirve para dibujar el mapa, no para compilar.
 */

export type PolyLanguage = "java" | "kotlin" | "scala" | "go" | "protobuf";

export interface PolyBlock {
  name: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentName?: string;
}

export const POLY_EXTENSIONS: Readonly<Record<string, PolyLanguage>> = {
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".go": "go",
  ".proto": "protobuf",
};

export function polyLanguageOf(path: string): PolyLanguage | null {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : (POLY_EXTENSIONS[path.slice(dot)] ?? null);
}

const MODIFIERS = String.raw`(?:(?:public|private|protected|internal|abstract|final|sealed|open|data|static|case|enum|annotation|inline|value)\s+)*`;

type StartPattern = { kind: PolyBlock["kind"]; re: RegExp; name: (match: RegExpMatchArray) => string; parent?: (match: RegExpMatchArray) => string | undefined };

const PATTERNS: Readonly<Record<PolyLanguage, readonly StartPattern[]>> = {
  java: [{ kind: "class", re: new RegExp(`^${MODIFIERS}(?:class|interface|enum|record|@interface)\\s+(\\w+)`), name: (m) => m[1] ?? "" }],
  kotlin: [
    { kind: "class", re: new RegExp(`^${MODIFIERS}(?:class|interface|object)\\s+(\\w+)`), name: (m) => m[1] ?? "" },
    { kind: "function", re: new RegExp(`^${MODIFIERS}(?:suspend\\s+)?fun\\s+(?:<[^>]+>\\s*)?(?:[\\w.]+\\.)?(\\w+)\\s*\\(`), name: (m) => m[1] ?? "" },
  ],
  scala: [
    { kind: "class", re: new RegExp(`^${MODIFIERS}(?:class|trait|object)\\s+(\\w+)`), name: (m) => m[1] ?? "" },
    { kind: "function", re: /^def\s+(\w+)/, name: (m) => m[1] ?? "" },
  ],
  go: [
    {
      kind: "method",
      re: /^func\s+\(\s*\w*\s*\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*(\w+)\s*[([]/,
      name: (m) => `${m[1]}.${m[2]}`,
      parent: (m) => m[1],
    },
    { kind: "function", re: /^func\s+(\w+)\s*[([]/, name: (m) => m[1] ?? "" },
    { kind: "class", re: /^type\s+(\w+)\s+(?:struct|interface)\b/, name: (m) => m[1] ?? "" },
  ],
  protobuf: [
    { kind: "class", re: /^service\s+(\w+)/, name: (m) => m[1] ?? "" },
    { kind: "class", re: /^message\s+(\w+)/, name: (m) => m[1] ?? "" },
  ],
};

/** Bloques de nivel superior (columna 0); en Protobuf, además, cada `rpc` como método de su servicio. */
export function scanPolySource(source: string, language: PolyLanguage): PolyBlock[] {
  const lines = source.split(/\r?\n/);
  const starts: { name: string; kind: PolyBlock["kind"]; line: number; parentName?: string }[] = [];
  let service: string | null = null;
  lines.forEach((line, index) => {
    if (language === "protobuf") {
      const rpc = line.match(/^\s+rpc\s+(\w+)\s*\(/);
      if (rpc?.[1] && service) {
        starts.push({ name: `${service}.${rpc[1]}`, kind: "method", line: index + 1, parentName: service });
        return;
      }
    }
    if (line.length === 0 || line[0] === " " || line[0] === "\t") return;
    for (const pattern of PATTERNS[language]) {
      const match = line.match(pattern.re);
      if (!match) continue;
      const name = pattern.name(match);
      if (!name) continue;
      const start: (typeof starts)[number] = { name, kind: pattern.kind, line: index + 1 };
      const parent = pattern.parent?.(match);
      if (parent) start.parentName = parent;
      starts.push(start);
      if (language === "protobuf") service = line.startsWith("service") ? name : null;
      return;
    }
  });

  let last = lines.length;
  while (last > 1 && (lines[last - 1] ?? "").trim() === "") last -= 1;
  // Los métodos de proto terminan en su propia línea; el resto, donde empieza el siguiente bloque de su nivel.
  return starts.map((start, index) => {
    let end: number;
    if (language === "protobuf" && start.kind === "method") {
      end = start.line;
    } else {
      const next = starts.slice(index + 1).find((item) => item.kind !== "method" || language !== "protobuf");
      end = next ? next.line - 1 : last;
      while (end > start.line && (lines[end - 1] ?? "").trim() === "") end -= 1;
    }
    const block: PolyBlock = { name: start.name, kind: start.kind, startLine: start.line, endLine: end };
    // En Go el tipo receptor puede declararse en otro archivo: solo se enlaza si está en este.
    if (start.parentName && starts.some((item) => item.kind === "class" && item.name === start.parentName)) {
      block.parentName = start.parentName;
    }
    return block;
  });
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

const MAX_WILDCARD_TARGETS = 12;

/**
 * Imports resueltos a archivos del repo:
 * - JVM: `import a.b.C` → `…/a/b/C.{java,kt,scala}`; `import a.b.*` → los archivos de `…/a/b/`.
 * - Go: `import "mod/internal/orders"` → los `.go` (no test) del directorio que acaba en esa ruta
 *   (se exigen ≥ 2 segmentos para no confundir `fmt` con una carpeta `fmt/`).
 * - Protobuf: `import "x/y.proto"` → el archivo que acaba en esa ruta.
 */
export function resolvePolyImports(source: string, filePath: string, known: ReadonlySet<string>, language: PolyLanguage): string[] {
  const files = [...known];
  const targets = new Set<string>();
  const add = (target: string | undefined) => {
    if (target && target !== filePath) targets.add(target);
  };

  if (language === "java" || language === "kotlin" || language === "scala") {
    for (const match of source.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+?)(\.\*|\._|\.\{[^}]*\})?\s*;?\s*$/gm)) {
      const path = (match[1] ?? "").replace(/\./g, "/");
      if (match[2]) {
        const inDir = files.filter((file) => dirOf(file).endsWith(path) && polyLanguageOf(file) !== null);
        for (const file of inDir.slice(0, MAX_WILDCARD_TARGETS)) add(file);
        continue;
      }
      add(files.find((file) => /\.(java|kt|scala)$/.test(file) && file.replace(/\.(java|kt|scala)$/, "").endsWith(path)));
      // `import a.b.C.method` (estático) → la clase `a/b/C`.
      const owner = path.slice(0, path.lastIndexOf("/"));
      if (owner) add(files.find((file) => /\.(java|kt|scala)$/.test(file) && file.replace(/\.(java|kt|scala)$/, "").endsWith(owner)));
    }
  } else if (language === "go") {
    const paths: string[] = [];
    for (const block of source.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)) {
      for (const item of (block[1] ?? "").matchAll(/"([^"]+)"/g)) if (item[1]) paths.push(item[1]);
    }
    for (const single of source.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) if (single[1]) paths.push(single[1]);
    for (const path of paths) {
      const segments = path.split("/");
      for (let take = segments.length; take >= 2; take -= 1) {
        const suffix = segments.slice(-take).join("/");
        const inDir = files.filter((file) => file.endsWith(".go") && !file.endsWith("_test.go") && (dirOf(file) === suffix || dirOf(file).endsWith(`/${suffix}`)));
        if (inDir.length === 0) continue;
        for (const file of inDir.slice(0, MAX_WILDCARD_TARGETS)) add(file);
        break;
      }
    }
  } else {
    for (const match of source.matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+\.proto)"/gm)) {
      const path = match[1] ?? "";
      add(files.find((file) => file === path || file.endsWith(`/${path}`)));
    }
  }
  return [...targets].sort();
}

/** Servicios declarados en un `.proto`. */
export function protoServices(source: string): string[] {
  return [...source.matchAll(/^service\s+(\w+)/gm)].map((match) => match[1] ?? "").filter(Boolean);
}
