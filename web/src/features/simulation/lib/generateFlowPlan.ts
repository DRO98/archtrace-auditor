import { logRawResponse, parseLooseJson } from "@/lib/ai/json";
import { AiError, type AiProvider } from "@/lib/ai/types";

export interface FlowServiceHint {
  id: string;
  label: string;
  role: string;
  kind: string;
}

export interface GeneratedFlowPlan {
  name: string;
  description: string;
  blockIds: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "blockIds"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    blockIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 10 },
  },
} as const;

/**
 * Pide a la IA un recorrido sobre los servicios del mapa (ids de bloque Level 0). Sin inventar nodos.
 */
export async function generateFlowPlan(input: {
  goal: string;
  services: readonly FlowServiceHint[];
  provider: AiProvider;
  signal: AbortSignal;
  lang?: "es" | "en";
}): Promise<GeneratedFlowPlan> {
  const lang = input.lang ?? "es";
  const catalog = input.services.map((item) => `- ${item.id} · ${item.label} (${item.kind}/${item.role})`).join("\n");
  const system =
    lang === "es"
      ? `Eres arquitecto de software. Diseñas un recorrido de simulación sobre un mapa de sistema.
Solo puedes usar los ids de servicio del catálogo. Ordena el flujo de datos (o la consulta) de forma realista.
Responde SOLO JSON con name, description (1-2 frases) y blockIds (2-10 ids del catálogo, en orden).`
      : `You are a software architect. You design a simulation journey on a system map.
You may only use service ids from the catalog. Order the data flow (or query path) realistically.
Reply with JSON only: name, description (1-2 sentences), blockIds (2-10 catalog ids, in order).`;
  const user = `${lang === "es" ? "Pedido del usuario" : "User request"}: ${input.goal}\n\n${lang === "es" ? "Catálogo" : "Catalog"}:\n${catalog}`;

  const raw = await input.provider.completeJson(
    { system, user, schema: SCHEMA as unknown as Record<string, unknown>, schemaName: "flow_plan", maxTokens: 800 },
    input.signal,
  );
  const parsed = normalize(raw, input.services);
  if (!parsed) {
    logRawResponse(input.provider.id, "plan de flujo inválido", raw);
    throw new AiError("bad_response", lang === "es" ? "La IA no devolvió un recorrido válido." : "The model did not return a valid journey.");
  }
  return parsed;
}

function normalize(raw: unknown, services: readonly FlowServiceHint[]): GeneratedFlowPlan | null {
  const value = typeof raw === "string" ? parseLooseJson(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.description !== "string" || !Array.isArray(record.blockIds)) return null;
  const allowed = new Set(services.map((item) => item.id));
  const blockIds = record.blockIds.filter((id): id is string => typeof id === "string" && allowed.has(id));
  if (blockIds.length < 2) return null;
  return {
    name: record.name.trim().slice(0, 80) || "Recorrido personalizado",
    description: record.description.trim().slice(0, 280) || "Recorrido generado por la IA.",
    blockIds,
  };
}
