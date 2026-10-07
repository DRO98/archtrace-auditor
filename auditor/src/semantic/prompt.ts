import { CRITICALITIES } from "@core/audit";
import type { Taxonomy } from "../rules/taxonomy";

/** Cambia cuando cambie el prompt o el esquema: invalida la caché de respuestas. */
export const PROMPT_VERSION = "audit-v1";
export const SCHEMA_NAME = "change_assessment";
/** Holgado: los modelos con razonamiento (gpt-5, o-series, gpt-oss) gastan parte del presupuesto antes del JSON. */
export const MAX_OUTPUT_TOKENS = 2000;

export function buildSystemPrompt(taxonomy: Taxonomy): string {
  const categories = taxonomy.categories.map((category) => `- ${category.id}: ${category.label}. ${category.description}`).join("\n");
  return [
    "Eres un auditor independiente de cambios de código hechos por agentes de IA. Evalúas UNA unidad de cambio",
    "(líneas añadidas `+` en head y borradas `-` de base) con contexto progresivo y las reglas del propio repositorio.",
    "",
    "Categorías permitidas (usa exactamente uno de estos ids, o `unknown` si ninguna encaja):",
    categories,
    "",
    "Criticidad:",
    "- critical: puede romper autenticación, autorización, aislamiento entre clientes, dinero o datos, o viola una regla marcada como crítica en el repo.",
    "- high: cambia comportamiento sensible (seguridad, integraciones, esquema, configuración) con riesgo real.",
    "- medium: cambia lógica de negocio o contratos con impacto acotado.",
    "- low: cosmético, documentación, tests o refactor sin cambio de comportamiento.",
    "- unknown: no puedes decidir con el contexto dado.",
    "",
    "Reglas de respuesta:",
    "- evidence: cita texto LITERAL de líneas cambiadas, sin el prefijo +/- ni el número de línea, con su número de línea. Nunca inventes código.",
    "- rule_refs: solo ids de sección que aparezcan entre corchetes en el bloque L4 (formato archivo#ancla). Si ninguna aplica, lista vacía.",
    "- Si el contexto no basta para decidir, pon needs_more_context=true y baja la confianza; se te dará más contexto.",
    "- confidence entre 0 y 1. reason: 1–3 frases en español con el riesgo concreto, sin repetir el diff.",
  ].join("\n");
}

export function buildUserMessage(context: string, level: number, maxLevel: number): string {
  return [
    `Nivel de contexto actual: L${level} (máximo L${maxLevel}).`,
    "",
    context,
    "",
    "Devuelve la valoración de esta unidad de cambio.",
  ].join("\n");
}

/** Esquema estricto (compatible con `json_schema` strict de OpenAI: todo requerido, sin propiedades extra). */
export function assessmentSchema(taxonomy: Taxonomy): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["category", "criticality", "confidence", "reason", "evidence", "rule_refs", "needs_more_context"],
    properties: {
      category: { type: "string", enum: [...taxonomy.categories.map((category) => category.id), "unknown"] },
      criticality: { type: "string", enum: [...CRITICALITIES] },
      confidence: { type: "number" },
      reason: { type: "string" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["line", "text"],
          properties: { line: { type: "integer" }, text: { type: "string" } },
        },
      },
      rule_refs: { type: "array", items: { type: "string" } },
      needs_more_context: { type: "boolean" },
    },
  };
}
