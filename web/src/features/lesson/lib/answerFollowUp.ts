import type { ProjectMap } from "@core/projectMap";
import { AiError, type AiProvider } from "@/lib/ai/types";
import type { AnswerEvidence, ChatTurn } from "@/features/history/types";
import { buildDigest, type ProjectDigest } from "./digest";
import { assessEvidence, evidenceCorrection, isGrounding, type Grounding } from "./evidence";
import { extractJson } from "./parseLesson";
import { FOLLOW_UP_JSON_SCHEMA } from "./lessonSchema";
import { pickSlice, rankFiles } from "./slice";
import { SINGLE_PASS_TOKEN_BUDGET } from "./generateLesson";
import { buildFollowUpSystemPrompt, buildFollowUpUserMessage } from "../prompts/teacherSystemPrompt";

const MAX_TOKENS = 1600;
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 4000;
const MAX_ANSWER_CHARS = 6000;

export interface FollowUpInput {
  question: string;
  nodeName: string;
  filePath: string | null;
  history: readonly ChatTurn[];
  map: ProjectMap;
  provider: AiProvider;
  signal: AbortSignal;
  outputLanguage?: string;
}

export interface FollowUpReply {
  answer: string;
  /** `lesson`: la pregunta pide un recorrido por el código; `lessonGoal` es la pregunta autocontenida para generarlo. */
  format: "text" | "lesson";
  lessonGoal: string;
  /** Respaldo en el mapa de `answer`; `null` en recorridos guiados, cuyos pasos se validan al generar la lección. */
  evidence: AnswerEvidence | null;
}

interface RawReply {
  answer: string;
  format: "text" | "lesson";
  lessonGoal: string;
  grounding: Grounding | null;
}

/**
 * Responde una pregunta del chat y la pasa por el filtro de evidencia: si afirma cosas del proyecto sin una sola
 * cita válida del mapa, se pide UNA reescritura. Si tampoco cita, se devuelve igualmente marcada como `missing`
 * (el panel lo avisa): mejor una respuesta señalada que ninguna.
 */
export async function answerFollowUp(input: FollowUpInput): Promise<FollowUpReply> {
  const digest = nodeDigest(input.map, input.filePath, input.question);
  const conversation = input.history.slice(-MAX_TURNS).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, MAX_TURN_CHARS),
  }));
  const system = buildFollowUpSystemPrompt({
    nodeName: input.nodeName,
    filePath: input.filePath,
    outputLanguage: input.outputLanguage,
  });
  const user = buildFollowUpUserMessage({
    nodeName: input.nodeName,
    filePath: input.filePath,
    revision: input.map.revision,
    digest: digest.text,
    conversation,
    question: input.question,
  });
  const ask = async (extra: string | null): Promise<RawReply> => {
    const raw = await input.provider.completeJson(
      {
        system,
        user: extra ? `${user}\n${extra}` : user,
        schema: FOLLOW_UP_JSON_SCHEMA,
        schemaName: "follow_up",
        maxTokens: MAX_TOKENS,
      },
      input.signal,
    );
    return readRawReply(typeof raw === "string" ? extractJson(raw) : raw, digest, input.map);
  };

  let reply = await ask(null);
  // Un recorrido guiado se valida paso a paso al generarlo; aquí solo se filtran las respuestas de texto.
  if (reply.format === "lesson") return finish(reply, null);
  let evidence = assessEvidence(reply.answer, reply.grounding, input.map);
  if (evidence === "missing") {
    const retry = await ask(evidenceCorrection(reply.answer)).catch((error: unknown) => {
      // Cancelar sí corta; cualquier otro fallo del reintento deja la primera respuesta (marcada).
      if (error instanceof AiError && error.code === "aborted") throw error;
      return null;
    });
    if (retry && retry.format === "text") {
      const retried = assessEvidence(retry.answer, retry.grounding, input.map);
      if (retried !== "missing") {
        reply = retry;
        evidence = retried;
      }
    }
  }
  return finish(reply, evidence);
}

function finish(reply: RawReply, evidence: AnswerEvidence | null): FollowUpReply {
  return {
    answer: reply.answer.slice(0, MAX_ANSWER_CHARS),
    format: reply.format,
    lessonGoal: reply.lessonGoal.slice(0, MAX_TURN_CHARS),
    evidence,
  };
}

function readRawReply(value: unknown, digest: ProjectDigest, map: ProjectMap): RawReply {
  if (typeof value !== "object" || value === null || !("answer" in value) || typeof value.answer !== "string") {
    throw new AiError("bad_response", "La IA no devolvió una respuesta válida.");
  }
  const answer = resolveHandles(value.answer.trim(), digest, map);
  if (!answer) throw new AiError("bad_response", "La IA no devolvió una respuesta válida.");
  const lessonGoal = "lessonGoal" in value && typeof value.lessonGoal === "string" ? value.lessonGoal.trim() : "";
  const format = "format" in value && value.format === "lesson" ? "lesson" : "text";
  const grounding = "grounding" in value && isGrounding(value.grounding) ? value.grounding : null;
  return { answer, format, lessonGoal, grounding };
}

/** El archivo del nodo más sus vecinos; sin nodo, todo el mapa si cabe o los archivos más afines. */
export function nodeDigest(map: ProjectMap, filePath: string | null, question: string): ProjectDigest {
  if (filePath && map.files.some((file) => file.filePath === filePath)) {
    return pickSlice(map, [filePath]);
  }
  const full = buildDigest(map);
  if (full.estimatedTokens <= SINGLE_PASS_TOKEN_BUDGET) return full;
  return pickSlice(map, rankFiles(map, question).slice(0, 6));
}

const HANDLE_CITE = /((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,5}):(S\d+)\b/g;

/**
 * Los modelos a veces citan el identificador interno del mapa (`src/rag/pipeline.py:S4`) en lugar de las líneas.
 * Se sustituye por `ruta:inicio-fin` del símbolo, que el panel sí sabe abrir; si no cuadra, se deja la ruta sola.
 */
export function resolveHandles(answer: string, digest: ProjectDigest, map: ProjectMap): string {
  return answer.replace(HANDLE_CITE, (_raw, path: string, handle: string) => {
    const id = digest.handles.get(handle);
    const file = map.files.find((item) => item.filePath === path);
    const symbol = id ? file?.symbols.find((item) => item.id === id) : undefined;
    return symbol ? `${path}:${symbol.range.startLine}-${symbol.range.endLine}` : path;
  });
}
