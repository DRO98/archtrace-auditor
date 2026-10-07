import type { PlaygroundModuleRef, PlaygroundSseEvent } from "@core/playground";
import { createProvider, readSelection } from "@/lib/ai";
import { isTokenPrice, resolvePrice, type ResolvedPrice } from "@/lib/ai/costEstimate";
import { runWithDeadline, unconfiguredResponse } from "@/lib/ai/route";
import { formatSseEvent } from "@/lib/rag/sse";
import { runRagTrace } from "@/lib/rag/trace";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 60_000;
const MAX_QUESTION_CHARS = 2000;
const MAX_DOCUMENT_CHARS = 200_000;
const MAX_MODULES = 500;

/**
 * Playground en vivo: POST `{ question, documentText, ai, pricing?, graphModules? }` → `text/event-stream`
 * con la traza del pipeline RAG (ver `PlaygroundSseEvent`). Los errores de validación y la falta
 * de proveedor responden JSON normal, antes de abrir el stream. `pricing` es la tarifa manual
 * (USD por 1M tokens) que el usuario fijó para el modelo elegido; sin ella se usa el catálogo.
 */
export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ error: "Falta la pregunta." }, { status: 400 });
  }
  if (typeof body.documentText !== "string" || body.documentText.trim().length === 0) {
    return Response.json({ error: "Falta el documento." }, { status: 400 });
  }

  const provider = createProvider(readSelection(body.ai));
  if (!provider) return unconfiguredResponse();

  const price: ResolvedPrice = isTokenPrice(body.pricing)
    ? { price: { input: body.pricing.input, output: body.pricing.output }, source: "custom" }
    : resolvePrice(provider.id, provider.model);
  const question = body.question.trim().slice(0, MAX_QUESTION_CHARS);
  const documentText = body.documentText.slice(0, MAX_DOCUMENT_CHARS);
  const modules = readModules(body.graphModules);
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort);

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const emit = (event: PlaygroundSseEvent): void => {
        if (controller.signal.aborted) return;
        try {
          sink.enqueue(encoder.encode(formatSseEvent(event)));
        } catch {
          controller.abort(); // el cliente se fue
        }
      };
      try {
        await runRagTrace({
          question,
          documentText,
          modules,
          provider: provider.id,
          model: provider.model,
          price,
          complete: (completion) =>
            runWithDeadline(request, provider, PROVIDER_TIMEOUT_MS, (signal) => provider.completeText(completion, signal)),
          emit,
          signal: controller.signal,
          startedAt,
        });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          sink.close();
        } catch {
          // Ya cerrado por cancelación.
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function readModules(raw: unknown): PlaygroundModuleRef[] {
  if (!Array.isArray(raw)) return [];
  const modules: PlaygroundModuleRef[] = [];
  for (const item of raw.slice(0, MAX_MODULES)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    modules.push({
      id: item.id,
      label: typeof item.label === "string" ? item.label : "",
      filePath: typeof item.filePath === "string" ? item.filePath : item.id,
    });
  }
  return modules;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
