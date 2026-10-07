/**
 * Lector YAML mínimo para archivos de despliegue (docker-compose): mapas y listas por indentación, escalares
 * planos o entre comillas, listas/mapas en línea de un nivel (`[a, b]`, `{k: v}`), bloques `|`/`>`, anclas
 * (`&x`), alias (`*x`) y fusión (`<<: *x`). No pretende cubrir la especificación: lo que no entiende lo
 * devuelve como texto, nunca lanza. Sin dependencias para no engordar el bundle del navegador.
 */

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue } | null;
export type YamlMap = { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  /** Línea (1-based) en el archivo original. */
  number: number;
}

/** Quita el comentario final (`# …` precedido de espacio y fuera de comillas). */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(raw[index - 1] ?? ""))) return raw.slice(0, index);
  }
  return raw;
}

function toLines(text: string): Line[] {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const content = stripComment(raw).replace(/\s+$/, "");
    if (content.trim().length === 0 || content.trim() === "---") return;
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), number: index + 1 });
  });
  return lines;
}

function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parte `a, "b, c", d` por comas de primer nivel. */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Separa `clave: resto` respetando comillas; null si la línea no es un par clave-valor. */
function splitKey(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if ((char === '"' || char === "'") && index === 0) quote = char;
    else if (char === ":" && (index === text.length - 1 || text[index + 1] === " ")) {
      return { key: unquote(text.slice(0, index)), rest: text.slice(index + 1).trim() };
    }
  }
  return null;
}

class Parser {
  private index = 0;
  private readonly anchors = new Map<string, YamlValue>();
  /** Línea donde empieza cada clave de primer y segundo nivel (`services.<nombre>`), para enlazar al editor. */
  readonly keyLines = new Map<string, { start: number; end: number }>();

  constructor(private readonly lines: Line[]) {}

  parseDocument(): YamlValue {
    return this.parseBlock(0, []);
  }

  private peek(): Line | undefined {
    return this.lines[this.index];
  }

  private parseBlock(indent: number, path: readonly string[]): YamlValue {
    const line = this.peek();
    if (!line || line.indent < indent) return null;
    return line.text.startsWith("- ") || line.text === "-" ? this.parseSequence(line.indent, path) : this.parseMap(line.indent, path);
  }

  private parseSequence(indent: number, path: readonly string[]): YamlValue[] {
    const items: YamlValue[] = [];
    for (let line = this.peek(); line && line.indent === indent && (line.text.startsWith("- ") || line.text === "-"); line = this.peek()) {
      const rest = line.text === "-" ? "" : line.text.slice(2).trim();
      if (rest.length === 0) {
        this.index += 1;
        items.push(this.parseBlock(indent + 1, path));
        continue;
      }
      if (splitKey(rest) && !rest.startsWith("{") && !rest.startsWith('"') && !rest.startsWith("'")) {
        // `- clave: valor` abre un mapa cuyo resto de claves va alineado con `clave`.
        const inner = indent + (line.text.length - rest.length);
        this.lines[this.index] = { ...line, indent: inner, text: rest };
        items.push(this.parseMap(inner, path));
        continue;
      }
      this.index += 1;
      items.push(this.parseInline(rest, indent, path));
    }
    return items;
  }

  private parseMap(indent: number, path: readonly string[]): YamlMap {
    const map: YamlMap = {};
    for (let line = this.peek(); line && line.indent === indent; line = this.peek()) {
      const pair = splitKey(line.text);
      if (!pair) {
        this.index += 1;
        continue;
      }
      this.index += 1;
      const childPath = [...path, pair.key];
      const start = line.number;
      const value = this.parseValue(pair.rest, indent, childPath);
      if (childPath.length <= 2) this.keyLines.set(childPath.join("."), { start, end: this.lastLineNumber() });
      if (pair.key === "<<") {
        const sources = Array.isArray(value) ? value : [value];
        for (const source of sources) {
          if (!source || typeof source !== "object" || Array.isArray(source)) continue;
          for (const [key, inherited] of Object.entries(source)) if (!(key in map)) map[key] = inherited;
        }
        continue;
      }
      map[pair.key] = value;
    }
    return map;
  }

  private lastLineNumber(): number {
    return this.lines[this.index - 1]?.number ?? 0;
  }

  /** Valor tras `clave:` (o tras `- `): alias, ancla, bloque literal, en línea o anidado. */
  private parseValue(rest: string, indent: number, path: readonly string[]): YamlValue {
    let text = rest;
    let anchor: string | null = null;
    const anchored = /^&([\w-]+)\s*(.*)$/.exec(text);
    if (anchored) {
      anchor = anchored[1] ?? null;
      text = anchored[2] ?? "";
    }
    let value: YamlValue;
    if (text.length === 0) {
      const next = this.peek();
      // Una lista puede ir a la misma indentación que su clave (`depends_on:\n- a`).
      if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")))) value = this.parseBlock(next.indent, path);
      else value = null;
    } else if (/^[|>][+-]?\d*$/.test(text)) {
      value = this.parseBlockScalar(indent, text.startsWith(">"));
    } else {
      value = this.parseInline(text, indent, path);
    }
    if (anchor) this.anchors.set(anchor, value);
    return value;
  }

  private parseBlockScalar(indent: number, folded: boolean): string {
    const parts: string[] = [];
    for (let line = this.peek(); line && line.indent > indent; line = this.peek()) {
      parts.push(line.text);
      this.index += 1;
    }
    return parts.join(folded ? " " : "\n");
  }

  private parseInline(text: string, indent: number, path: readonly string[]): YamlValue {
    const alias = /^\*([\w-]+)$/.exec(text);
    if (alias) return this.anchors.get(alias[1] ?? "") ?? null;
    if (text.startsWith("[") && text.endsWith("]")) return splitFlow(text.slice(1, -1)).map((part) => this.parseInline(part, indent, path));
    if (text.startsWith("{") && text.endsWith("}")) {
      const map: YamlMap = {};
      for (const part of splitFlow(text.slice(1, -1))) {
        const pair = splitKey(part) ?? (part.includes(":") ? { key: part.slice(0, part.indexOf(":")).trim(), rest: part.slice(part.indexOf(":") + 1).trim() } : null);
        if (pair) map[pair.key] = this.parseInline(pair.rest, indent, path);
      }
      return map;
    }
    // Escalar plano que continúa en líneas más indentadas (texto partido en varias líneas sin `>`).
    const parts = [text];
    for (let line = this.peek(); line && line.indent > indent && !splitKey(line.text) && !line.text.startsWith("- "); line = this.peek()) {
      parts.push(line.text);
      this.index += 1;
    }
    const joined = parts.join(" ");
    if (joined === "null" || joined === "~") return null;
    return unquote(joined);
  }
}

export interface ParsedYaml {
  value: YamlValue;
  /** `clave` o `padre.clave` (dos primeros niveles) → líneas que ocupa en el archivo. */
  keyLines: ReadonlyMap<string, { start: number; end: number }>;
}

export function parseYaml(text: string): ParsedYaml {
  const parser = new Parser(toLines(text));
  try {
    return { value: parser.parseDocument(), keyLines: parser.keyLines };
  } catch {
    return { value: null, keyLines: parser.keyLines };
  }
}

export function isYamlMap(value: YamlValue | undefined): value is YamlMap {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}
