import { createProvider, readSelection } from "@/lib/ai";
import { aiErrorResponse, runWithDeadline, unconfiguredResponse } from "@/lib/ai/route";
import { generateFlowPlan, type FlowServiceHint } from "@/features/simulation/lib/generateFlowPlan";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.goal !== "string" || body.goal.trim().length === 0) {
    return Response.json({ error: "Falta la descripción del recorrido." }, { status: 400 });
  }
  const services = readServices(body.services);
  if (services.length < 2) {
    return Response.json({ error: "Hacen falta al menos 2 servicios del mapa." }, { status: 400 });
  }
  const provider = createProvider(readSelection(body.ai));
  if (!provider) return unconfiguredResponse();

  const lang = body.lang === "en" ? "en" : "es";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  try {
    const plan = await runWithDeadline(request, provider, PROVIDER_TIMEOUT_MS, (signal) =>
      generateFlowPlan({ goal, services, provider, signal, lang }),
    );
    return Response.json({ plan });
  } catch (error) {
    return aiErrorResponse(error, "La IA no devolvió un recorrido válido.", "api/flow-scenario");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readServices(value: unknown): FlowServiceHint[] {
  if (!Array.isArray(value)) return [];
  const out: FlowServiceHint[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.label !== "string") continue;
    out.push({
      id: item.id,
      label: item.label,
      role: typeof item.role === "string" ? item.role : "app",
      kind: typeof item.kind === "string" ? item.kind : "service",
    });
  }
  return out;
}
