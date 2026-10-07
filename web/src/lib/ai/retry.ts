import { isTransientStatus, readStatus } from "./errors";

/** Esperas más largas (cuota diaria agotada, p. ej.) no se reintentan: el usuario ve el 429 enseguida. */
const MAX_RETRY_WAIT_MS = 8_000;
const BASE_DELAY_MS = 1_200;

/**
 * Reintenta `run` ante 429 / 5xx / 529 con espera corta (respeta `retryAfterMs` si el error lo trae).
 * Los proveedores por `fetch` o SDK sin reintentos (Anthropic, Gemini) lo usan; el SDK de OpenAI ya reintenta solo.
 */
export async function withTransientRetry<T>(run: () => Promise<T>, signal: AbortSignal, retries = 1): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const wait = retryDelay(error, attempt);
      if (attempt >= retries || wait === null || signal.aborted) throw error;
      await sleep(wait, signal);
    }
  }
}

/** Milisegundos a esperar antes de reintentar, o null si el error no es transitorio. */
export function retryDelay(error: unknown, attempt: number): number | null {
  const status = readStatus(error);
  if (status === null || (status !== 429 && !isTransientStatus(status))) return null;
  const hinted = readRetryAfter(error);
  if (hinted !== null) return hinted <= MAX_RETRY_WAIT_MS ? hinted : null;
  return BASE_DELAY_MS * (attempt + 1);
}

/** Cabecera `retry-after` en segundos → ms. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function readRetryAfter(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("retryAfterMs" in error)) return null;
  return typeof error.retryAfterMs === "number" ? error.retryAfterMs : null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
