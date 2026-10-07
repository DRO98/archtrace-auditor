/**
 * Cuota Free sin cuentas: se cuentan en ESTE navegador los grafos distintos importados (`gh-*`, `local-*`).
 * Volver a importar uno ya contado no gasta cuota; las demos del catálogo y el repo del IDE nunca pasan por aquí.
 * Es una barrera de producto, no de seguridad: quien borre `localStorage` la reinicia, y está asumido.
 */
import { isMemoryGraphName } from "@/features/canvas/lib/memoryGraphs";

export const FREE_REPO_LIMIT = 2;
/** Graph findings visibles en Free; el drift no cuenta (ya era gratis antes del plan). */
export const FREE_FINDINGS_LIMIT = 3;
export const QUOTA_KEY = "archtrace.importedRepos";

export interface QuotaStatus {
  used: number;
  limit: number;
  /** `Infinity` en Pro. */
  remaining: number;
}

export function quotaStatus(imported: readonly string[], pro: boolean): QuotaStatus {
  const used = new Set(imported).size;
  if (pro) return { used, limit: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY };
  return { used, limit: FREE_REPO_LIMIT, remaining: Math.max(0, FREE_REPO_LIMIT - used) };
}

/** ¿Se puede importar `name`? Siempre en Pro, siempre si ya estaba contado (reimportar), si no, mientras quede cuota. */
export function canImport(name: string, imported: readonly string[], pro: boolean): boolean {
  if (pro || !isMemoryGraphName(name) || imported.includes(name)) return true;
  return new Set(imported).size < FREE_REPO_LIMIT;
}

export function withImported(imported: readonly string[], name: string): string[] {
  return !isMemoryGraphName(name) || imported.includes(name) ? [...imported] : [...imported, name];
}

export function parseImported(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && isMemoryGraphName(item)) : [];
  } catch {
    return [];
  }
}
