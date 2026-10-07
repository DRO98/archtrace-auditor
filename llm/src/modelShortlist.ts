import { AI_PROVIDERS, type AiProviderId } from "./catalog";

/** Modelos por proveedor en los selectores: suficientes para elegir, sin volcar listas de 200. */
export const MAX_PER_PROVIDER = 8;

export interface ModelShortlist<T> {
  /** Los primeros `max` (catálogo primero, en su orden), más `keep` si se quedaba fuera. */
  shortlist: T[];
  /** El resto, en el orden en que los devolvió el proveedor. */
  rest: T[];
}

/**
 * Parte los modelos que sirve un proveedor en una lista corta y el resto. Los del catálogo van
 * primero (son los conocidos y con tarifa); `keep` (p. ej. el modelo elegido) nunca queda oculto.
 */
export function shortlistModels<T extends { id: string }>(
  provider: AiProviderId,
  models: readonly T[],
  options: { max?: number; keep?: string } = {},
): ModelShortlist<T> {
  const max = options.max ?? MAX_PER_PROVIDER;
  const catalogOrder = new Map(AI_PROVIDERS[provider].models.map((item, index) => [item.id, index]));
  const catalog = models.filter((item) => catalogOrder.has(item.id)).sort((a, b) => catalogOrder.get(a.id)! - catalogOrder.get(b.id)!);
  const ordered = [...catalog, ...models.filter((item) => !catalogOrder.has(item.id))];
  const shortlist = ordered.slice(0, max);
  const rest = ordered.slice(max);
  const kept = rest.findIndex((item) => item.id === options.keep);
  if (kept >= 0) shortlist.push(...rest.splice(kept, 1));
  return { shortlist, rest };
}
