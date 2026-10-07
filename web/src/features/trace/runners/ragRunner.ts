import type { PlaygroundSseEvent } from "@core/playground";
import type { DemoPlayground } from "@/features/demos/types";
import { replayDemo } from "@/features/demos/lib/replay";
import type { TokenPrice } from "@/lib/ai/costEstimate";
import type { AiSelection } from "@/lib/ai/types";
import { createSseParser } from "@/lib/rag/sse";
import type { TraceRunContext, TraceRunner } from "./types";

export interface RagTraceInput {
  question: string;
  documentText: string;
  /** Selección BYOK (proveedor, modelo y clave del vault). */
  ai: AiSelection;
  pricing?: TokenPrice;
  /** Demo cargada: la traza se reproduce en el navegador (sin red ni API key). */
  demo: DemoPlayground | null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  } catch {
    // Cuerpo no JSON: mensaje genérico.
  }
  return `El servidor respondió HTTP ${response.status}.`;
}

/**
 * Perfil RAG: la consulta real va a `/api/playground/run` (SSE) con la clave del usuario; en demo se
 * reproducen los mismos eventos en el navegador. Si el stream se corta sin `done`, no emite nada más:
 * quien consume decide cómo tratarlo.
 */
export const ragRunner: TraceRunner<RagTraceInput, PlaygroundSseEvent> = {
  profile: "rag",
  async run(input: RagTraceInput, context: TraceRunContext<PlaygroundSseEvent>): Promise<void> {
    const { signal, emit } = context;
    if (input.demo) {
      await replayDemo(input.demo, signal, emit);
      return;
    }
    const response = await fetch("/api/playground/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: input.question,
        documentText: input.documentText,
        ai: input.ai,
        pricing: input.pricing,
        graphModules: context.modules.map(({ id, label, filePath }) => ({ id, label, filePath })),
      }),
      signal,
    });

    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("text/event-stream") || !response.body) {
      emit({ type: "error", message: await readError(response) });
      return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = createSseParser();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const event of parser.push(value)) emit(event);
    }
    for (const event of parser.flush()) emit(event);
  },
};
