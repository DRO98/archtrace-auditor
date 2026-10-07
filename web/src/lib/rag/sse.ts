import type { PlaygroundSseEvent, PlaygroundStageId } from "@core/playground";

/** Un evento SSE con solo `data:` (una línea: el JSON no lleva saltos de línea sin escapar). */
export function formatSseEvent(event: PlaygroundSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const STAGES: readonly PlaygroundStageId[] = ["api", "chunker", "embedder", "vector_store", "llm"];

/** Comprueba la forma mínima de cada evento: lo que llega por la red no se da por bueno. */
export function readSseEvent(raw: unknown): PlaygroundSseEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as Record<string, unknown>;
  const isStage = typeof event.stage === "string" && (STAGES as readonly string[]).includes(event.stage);
  const nodeOk = event.nodeId === null || typeof event.nodeId === "string";
  switch (event.type) {
    case "stage_start":
      return isStage && nodeOk ? (event as PlaygroundSseEvent) : null;
    case "stage_done":
      return isStage && nodeOk && typeof event.latencyMs === "number" ? (event as PlaygroundSseEvent) : null;
    case "edge_active":
      return typeof event.edgeId === "string" ? (event as PlaygroundSseEvent) : null;
    case "llm_delta":
      return typeof event.text === "string" ? (event as PlaygroundSseEvent) : null;
    case "result":
      return typeof event.answer === "string" && Array.isArray(event.chunks) && typeof event.usage === "object" && event.usage !== null
        ? (event as PlaygroundSseEvent)
        : null;
    case "error":
      return typeof event.message === "string" ? (event as PlaygroundSseEvent) : null;
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

/**
 * Parser incremental de `text/event-stream`: recibe trozos arbitrarios (un evento puede llegar
 * partido entre dos lecturas) y devuelve los eventos completos. Ignora comentarios y campos
 * distintos de `data`, y descarta JSON inválido o eventos desconocidos.
 */
export function createSseParser(): { push: (chunk: string) => PlaygroundSseEvent[]; flush: () => PlaygroundSseEvent[] } {
  let buffer = "";

  const parseBlock = (block: string): PlaygroundSseEvent | null => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return null;
    try {
      return readSseEvent(JSON.parse(data));
    } catch {
      return null;
    }
  };

  const drain = (final: boolean): PlaygroundSseEvent[] => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (blocks.pop() ?? "");
    const events: PlaygroundSseEvent[] = [];
    for (const block of blocks) {
      const event = parseBlock(block);
      if (event) events.push(event);
    }
    return events;
  };

  return {
    push: (chunk) => {
      buffer += chunk;
      return drain(false);
    },
    flush: () => drain(true),
  };
}
