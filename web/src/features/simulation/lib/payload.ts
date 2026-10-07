export interface FormatOptions {
  maxDepth: number;
  maxItems: number;
  maxString: number;
  maxChars: number;
}

const DEFAULTS: FormatOptions = { maxDepth: 5, maxItems: 8, maxString: 160, maxChars: 1600 };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>, options: FormatOptions): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return clip(value, options.maxString);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null;
  if (seen.has(value)) return "[circular]";
  if (depth >= options.maxDepth) return "…";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, options.maxItems).map((item) => sanitize(item, depth + 1, seen, options));
    if (value.length > options.maxItems) items.push(`… +${value.length - options.maxItems} más`);
    return items;
  }

  const entries = Object.entries(value);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, options.maxItems * 2)) {
    result[key] = sanitize(item, depth + 1, seen, options);
  }
  if (entries.length > options.maxItems * 2) {
    result["…"] = `+${entries.length - options.maxItems * 2} claves más`;
  }
  return result;
}

/**
 * Texto para mostrar un payload de ejemplo. Nunca lanza y siempre acota el tamaño:
 * profundidad, nº de elementos, longitud de cadenas y total de caracteres.
 * Se pinta como texto (nunca como HTML).
 */
export function formatPayload(value: unknown, overrides: Partial<FormatOptions> = {}): string {
  const options = { ...DEFAULTS, ...overrides };
  if (typeof value === "string") return clip(value, options.maxChars);
  try {
    const safe = sanitize(value, 0, new WeakSet<object>(), options);
    return clip(JSON.stringify(safe, null, 2) ?? "null", options.maxChars);
  } catch {
    return "(no se puede mostrar)";
  }
}

/** Resumen corto para la etiqueta que viaja con el paquete: `{document_id, text}` o `"¿Qué hace…"`. */
export function summarizePayload(value: Record<string, unknown> | string, max = 32): string {
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    return `"${clip(flat, max)}"`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const shown = keys.slice(0, 3).join(", ");
  const rest = keys.length > 3 ? `, +${keys.length - 3}` : "";
  return clip(`{${shown}${rest}}`, max + 8);
}
