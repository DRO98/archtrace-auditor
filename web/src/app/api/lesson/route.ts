import { createProvider, readSelection } from "@/lib/ai";
import { aiErrorResponse, runWithDeadline, unconfiguredResponse } from "@/lib/ai/route";
import { generateLesson } from "@/features/lesson/lib/generateLesson";
import { parseProjectMap } from "@/lib/projectMap";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 90_000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.goal !== "string" || body.goal.trim().length === 0) {
    return Response.json({ error: "Falta la pregunta de la lección." }, { status: 400 });
  }

  const map = parseProjectMap(body.map);
  if (!map) {
    return Response.json({ error: "El mapa del proyecto no es válido." }, { status: 400 });
  }

  const provider = createProvider(readSelection(body.ai));
  if (!provider) return unconfiguredResponse();

  const goal = body.goal.trim();
  const outputLanguage = typeof body.outputLanguage === "string" ? body.outputLanguage : undefined;
  try {
    const lesson = await runWithDeadline(request, provider, PROVIDER_TIMEOUT_MS, (signal) =>
      generateLesson({ goal, map, provider, signal, outputLanguage }),
    );
    return Response.json({ lesson });
  } catch (error) {
    return aiErrorResponse(error, "La IA no devolvió una lección válida.", "api/lesson");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
