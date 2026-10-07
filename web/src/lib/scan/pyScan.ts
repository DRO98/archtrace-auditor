export interface PythonBlock {
  name: string;
  kind: "class" | "function" | "method";
  startLine: number;
  endLine: number;
  parentName?: string;
}

interface Header {
  index: number;
  indent: number;
  kind: "class" | "def";
  name: string;
  startIndex: number;
}

function indentOf(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function headerAt(line: string): { indent: number; kind: "class" | "def"; name: string } | null {
  const indent = indentOf(line);
  if (indent !== 0 && indent !== 4) return null;
  const body = line.slice(indent);
  if (body.startsWith(" ") || body.startsWith("\t")) return null;

  let rest = body.trimEnd();
  let kind: "class" | "def";
  if (rest.startsWith("async def ")) {
    rest = rest.slice("async def ".length);
    kind = "def";
  } else if (rest.startsWith("def ")) {
    rest = rest.slice("def ".length);
    kind = "def";
  } else if (rest.startsWith("class ")) {
    rest = rest.slice("class ".length);
    kind = "class";
  } else {
    return null;
  }

  let name = "";
  for (const char of rest) {
    const code = char.charCodeAt(0);
    const ok =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "_";
    if (!ok) break;
    name += char;
  }
  if (name.length === 0) return null;
  return { indent, kind, name };
}

function decoratorStart(lines: readonly string[], headerIndex: number, indent: number): number {
  let start = headerIndex;
  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    if (indentOf(line) === indent && line.trimStart().startsWith("@")) {
      start = index;
      continue;
    }
    break;
  }
  return start;
}

function lastContentBefore(lines: readonly string[], boundary: number): number {
  let index = boundary - 1;
  while (index >= 0 && (lines[index] ?? "").trim() === "") index -= 1;
  return index;
}

export function scanPythonSource(source: string): PythonBlock[] {
  const lines = source.split(/\r?\n/);
  const headers: Header[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const found = headerAt(lines[index] ?? "");
    if (!found) continue;
    headers.push({
      index,
      indent: found.indent,
      kind: found.kind,
      name: found.name,
      startIndex: decoratorStart(lines, index, found.indent),
    });
  }

  const blocks: PythonBlock[] = [];
  for (const header of headers) {
    let boundary = lines.length;
    for (const other of headers) {
      if (other.indent <= header.indent && other.index > header.index && other.startIndex < boundary) {
        boundary = other.startIndex;
      }
    }
    const endIndex = lastContentBefore(lines, boundary);
    if (endIndex < header.startIndex) continue;

    let parentName: string | undefined;
    if (header.kind === "def" && header.indent === 4) {
      for (let cursor = headers.length - 1; cursor >= 0; cursor -= 1) {
        const candidate = headers[cursor];
        if (!candidate || candidate.kind !== "class" || candidate.indent !== 0) continue;
        if (candidate.index < header.index) {
          parentName = candidate.name;
          break;
        }
      }
    }

    const block: PythonBlock = {
      name: parentName ? `${parentName}.${header.name}` : header.name,
      kind: header.kind === "class" ? "class" : parentName ? "method" : "function",
      startLine: header.startIndex + 1,
      endLine: endIndex + 1,
    };
    if (parentName) block.parentName = parentName;
    blocks.push(block);
  }

  blocks.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.name.localeCompare(right.name));
  return blocks;
}

function stripComment(value: string): string {
  const hash = value.indexOf("#");
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

function importModules(trimmed: string): string[] {
  if (trimmed.startsWith("import ")) {
    const body = stripComment(trimmed.slice("import ".length));
    const modules: string[] = [];
    for (const part of body.split(",")) {
      const name = part.trim().split(" ")[0] ?? "";
      if (name.length > 0) modules.push(name);
    }
    return modules;
  }
  if (trimmed.startsWith("from ")) {
    const body = stripComment(trimmed.slice("from ".length));
    const marker = " import ";
    const index = body.indexOf(marker);
    if (index === -1) return [];
    const spec = body.slice(0, index).trim();
    return spec.length > 0 ? [spec] : [];
  }
  return [];
}

function resolveRelative(spec: string, filePath: string): string | null {
  let dots = 0;
  while (spec[dots] === ".") dots += 1;
  const rest = spec.slice(dots);
  const dir = filePath.split("/");
  dir.pop();
  const ups = dots - 1;
  if (ups > dir.length) return null;
  for (let index = 0; index < ups; index += 1) dir.pop();
  if (rest.length === 0) return null;
  for (const part of rest.split(".")) {
    if (part.length === 0) return null;
    dir.push(part);
  }
  return `${dir.join("/")}.py`;
}

function resolveModule(spec: string, filePath: string, knownFiles: ReadonlySet<string>): string | null {
  if (spec.startsWith(".")) {
    const relative = resolveRelative(spec, filePath);
    return relative !== null && knownFiles.has(relative) ? relative : null;
  }
  const base = spec.split(".").join("/");
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
  // Paquete desde la raíz, bajo `src/` y, para scripts lanzados desde su carpeta (`python app.py`, `working_dir`),
  // el módulo hermano: `from cifras import x` junto a `cifras.py`.
  for (const candidate of [`${base}.py`, `${base}/__init__.py`, `src/${base}.py`, `${dir}${base}.py`, `${dir}${base}/__init__.py`]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return uniqueByStem(spec, knownFiles);
}

/**
 * `from agente import X` sin paquete ni hermano: si en todo el repo hay un solo `agente.py` (fuera de tests), es ese
 * (típico de `PYTHONPATH` apuntando a otra carpeta del monorepo). Con varios candidatos no se adivina.
 */
function uniqueByStem(spec: string, knownFiles: ReadonlySet<string>): string | null {
  if (spec.includes(".")) return null;
  const suffix = `/${spec}.py`;
  let match: string | null = null;
  for (const file of knownFiles) {
    if (!(file === `${spec}.py` || file.endsWith(suffix)) || /(^|\/)tests?\//.test(file)) continue;
    if (match) return null;
    match = file;
  }
  return match;
}

export function resolveImports(
  source: string,
  filePath: string,
  knownFiles: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ") && !trimmed.startsWith("from ")) continue;
    for (const spec of importModules(trimmed)) {
      const resolved = resolveModule(spec, filePath, knownFiles);
      if (resolved) found.add(resolved);
    }
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}
