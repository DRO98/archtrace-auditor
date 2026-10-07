/**
 * Contadores de dogfood que se quedan en ESTE navegador (`localStorage`): imports empezados, terminados y fallidos,
 * y el tiempo desde que empieza un import hasta que el lienzo pinta Level 0. No se envían a ningún sitio (ZDR):
 * sirven para repetir la matriz de `docs/DOGFOOD_REPOS.md` con números en vez de impresiones.
 *
 * Leerlos: en la consola del navegador, `JSON.parse(localStorage.getItem("teacher:local-metrics"))`.
 */

export const LOCAL_METRICS_KEY = "teacher:local-metrics";
/** Muestras de tiempo a Level 0 que se conservan (las más recientes). */
const MAX_SAMPLES = 20;

export interface LocalMetrics {
  version: 1;
  importsStarted: number;
  importsCompleted: number;
  importsFailed: number;
  /** Milisegundos desde «Importar» hasta el primer Level 0 pintado, más recientes al final. */
  timeToLevel0Ms: number[];
}

export type MetricEvent =
  | { type: "import-started" }
  | { type: "import-completed" }
  | { type: "import-failed" }
  | { type: "level0-shown"; ms: number };

export function emptyMetrics(): LocalMetrics {
  return { version: 1, importsStarted: 0, importsCompleted: 0, importsFailed: 0, timeToLevel0Ms: [] };
}

export function applyMetric(metrics: LocalMetrics, event: MetricEvent): LocalMetrics {
  switch (event.type) {
    case "import-started":
      return { ...metrics, importsStarted: metrics.importsStarted + 1 };
    case "import-completed":
      return { ...metrics, importsCompleted: metrics.importsCompleted + 1 };
    case "import-failed":
      return { ...metrics, importsFailed: metrics.importsFailed + 1 };
    case "level0-shown":
      return { ...metrics, timeToLevel0Ms: [...metrics.timeToLevel0Ms, Math.round(event.ms)].slice(-MAX_SAMPLES) };
  }
}

function isMetrics(value: unknown): value is LocalMetrics {
  const record = value as Partial<LocalMetrics> | null;
  return (
    typeof record === "object" &&
    record !== null &&
    record.version === 1 &&
    typeof record.importsStarted === "number" &&
    typeof record.importsCompleted === "number" &&
    typeof record.importsFailed === "number" &&
    Array.isArray(record.timeToLevel0Ms)
  );
}

export function readLocalMetrics(): LocalMetrics {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LOCAL_METRICS_KEY) ?? "null");
    return isMetrics(parsed) ? parsed : emptyMetrics();
  } catch {
    return emptyMetrics();
  }
}

export function recordMetric(event: MetricEvent): void {
  try {
    window.localStorage.setItem(LOCAL_METRICS_KEY, JSON.stringify(applyMetric(readLocalMetrics(), event)));
  } catch {
    // Sin localStorage (modo privado estricto, SSR): las métricas son opcionales.
  }
}

/** Import en curso: cuándo empezó y, al terminar, qué grafo produjo. Vive en memoria (la navegación es SPA). */
let pending: { startedAt: number; graphName: string | null } | null = null;

export function markImportStarted(now = Date.now()): void {
  pending = { startedAt: now, graphName: null };
  recordMetric({ type: "import-started" });
}

export function markImportFinished(graphName: string | null): void {
  recordMetric({ type: graphName ? "import-completed" : "import-failed" });
  pending = graphName && pending ? { ...pending, graphName } : null;
}

/**
 * El lienzo abrió `graphName`. Si viene del import en curso, se mide el tiempo hasta aquí cuando se pinta Level 0;
 * si abre directo en el detalle (grafo pequeño), no hay muestra. En ambos casos el import deja de estar pendiente.
 */
export function markCanvasOpened(graphName: string, showsLevel0: boolean, now = Date.now()): number | null {
  if (!pending || pending.graphName !== graphName) return null;
  const ms = now - pending.startedAt;
  pending = null;
  if (!showsLevel0) return null;
  recordMetric({ type: "level0-shown", ms });
  return ms;
}
