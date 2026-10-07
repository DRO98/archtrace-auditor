import type { Lesson, ProjectMap } from "@core/index";
import { logRawResponse } from "@/lib/ai/json";
import { AiError, type AiProvider } from "@/lib/ai/types";
import { buildDigest } from "./digest";
import { LESSON_JSON_SCHEMA, SELECTOR_JSON_SCHEMA } from "./lessonSchema";
import { extractJson, finalizeLesson, findCodeLikeTokens, validateModelOutput } from "./parseLesson";
import {
  buildSelectorSystemPrompt,
  buildSelectorUserMessage,
  buildTeacherSystemPrompt,
  buildUserMessage,
} from "../prompts/teacherSystemPrompt";
import { buildOutline, pickSlice, rankFiles } from "./slice";

export const SINGLE_PASS_TOKEN_BUDGET = 12_000;
const MAX_TOKENS = 2500;

export type LessonStage = "selecting" | "writing" | "validating";

export interface GenerateLessonInput {
  goal: string;
  map: ProjectMap;
  provider: AiProvider;
  signal: AbortSignal;
  outputLanguage?: string;
  onStage?: (stage: LessonStage) => void;
}

export async function generateLesson(input: GenerateLessonInput): Promise<Lesson> {
  const full = buildDigest(input.map);
  const scope = full.estimatedTokens <= SINGLE_PASS_TOKEN_BUDGET ? "full" : "selected files";
  const digest =
    scope === "full" ? full : await selectSlice(input);

  input.onStage?.("writing");
  const system = buildTeacherSystemPrompt({ outputLanguage: input.outputLanguage });
  let user = buildUserMessage(input.goal, input.map.revision, scope, digest.text);
  let raw = await completeLesson(input.provider, system, user, input.signal);

  input.onStage?.("validating");
  let validated = validateModelOutput(raw);
  const codeHeavy = validated.ok && tooMuchCode(validated.value.steps.map((step) => step.summary));

  if (!validated.ok || codeHeavy) {
    const errors = validated.ok ? ["quita nombres de código de los summary"] : validated.errors;
    user = `${user}\nCorrige la lección. Errores: ${errors.join("; ")}. Quita nombres de código de los resúmenes.`;
    raw = await completeLesson(input.provider, system, user, input.signal);
    validated = validateModelOutput(raw);
  }

  if (!validated.ok) {
    logRawResponse(input.provider.id, `lección con esquema inválido: ${validated.errors.join(", ")}`, raw);
    throw new AiError("bad_response", "La IA no devolvió una lección válida.", `campos inválidos: ${validated.errors.join(", ")}`);
  }

  const finalized = finalizeLesson(validated.value, digest, input.map, {
    goal: input.goal,
    provider: input.provider.id,
    model: input.provider.model,
  });
  if (!finalized.lesson) {
    logRawResponse(input.provider.id, `ningún paso apunta a un símbolo conocido: ${finalized.warnings.join("; ")}`, raw);
    throw new AiError("bad_response", "La IA no devolvió una lección válida.", finalized.warnings.slice(0, 5).join("; "));
  }
  return finalized.lesson;
}

async function selectSlice(input: GenerateLessonInput) {
  input.onStage?.("selecting");
  const outline = buildOutline(input.map, input.goal, input.map.files.length > 600 ? 80 : input.map.files.length);
  let files = rankFiles(input.map, input.goal).slice(0, 8);
  try {
    const raw = await input.provider.completeJson(
      {
        system: buildSelectorSystemPrompt(),
        user: buildSelectorUserMessage(input.goal, outline),
        schema: SELECTOR_JSON_SCHEMA,
        schemaName: "file_selector",
        maxTokens: 800,
      },
      input.signal,
    );
    const parsed = parseSelector(raw, input.map);
    if (parsed) files = parsed;
  } catch (error) {
    if (error instanceof AiError && error.code === "aborted") throw error;
  }
  return pickSlice(input.map, files);
}

function parseSelector(raw: unknown, map: ProjectMap): string[] | null {
  const value = typeof raw === "string" ? extractJson(raw) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const files = "files" in value ? value.files : null;
  if (!Array.isArray(files)) return null;
  const known = new Set(map.files.map((file) => file.filePath));
  const picked = files.filter((item): item is string => typeof item === "string" && known.has(item)).slice(0, 10);
  return picked.length > 0 ? picked : null;
}

async function completeLesson(provider: AiProvider, system: string, user: string, signal: AbortSignal): Promise<unknown> {
  const raw = await provider.completeJson(
    { system, user, schema: LESSON_JSON_SCHEMA, schemaName: "lesson", maxTokens: MAX_TOKENS },
    signal,
  );
  return typeof raw === "string" ? extractJson(raw) : raw;
}

function tooMuchCode(summaries: readonly string[]): boolean {
  if (summaries.length === 0) return false;
  const noisy = summaries.filter((summary) => findCodeLikeTokens(summary).length > 0).length;
  return noisy / summaries.length > 0.3;
}
