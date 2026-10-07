import { createProvider, readSelection } from "@/lib/ai";
import { aiErrorResponse, runWithDeadline, unconfiguredResponse } from "@/lib/ai/route";
import { AiError } from "@/lib/ai/types";
import { answerFollowUp, type FollowUpReply } from "@/features/lesson/lib/answerFollowUp";
import { generateLesson } from "@/features/lesson/lib/generateLesson";
import type { ChatTurn } from "@/features/history/types";
import { parseProjectMap } from "@/lib/projectMap";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 60_000;
const LESSON_TIMEOUT_MS = 90_000;
const MAX_QUESTION_CHARS = 2000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo no es JSON." }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ error: "Falta la pregunta." }, { status: 400 });
  }
  if (!isRecord(body.node) || typeof body.node.nodeName !== "string") {
    return Response.json({ error: "Falta el nodo de la conversación." }, { status: 400 });
  }
  const filePath = typeof body.node.filePath === "string" ? body.node.filePath : null;
  const history = readHistory(body.history);
  if (!history) {
    return Response.json({ error: "El historial no es válido." }, { status: 400 });
  }

  const map = parseProjectMap(body.map);
  if (!map) {
    return Response.json({ error: "El mapa del proyecto no es válido." }, { status: 400 });
  }

  const provider = createProvider(readSelection(body.ai));
  if (!provider) return unconfiguredResponse();

  const question = body.question.trim().slice(0, MAX_QUESTION_CHARS);
  const nodeName = body.node.nodeName;
  let reply: FollowUpReply;
  try {
    reply = await runWithDeadline(request, provider, PROVIDER_TIMEOUT_MS, (signal) =>
      answerFollowUp({ question, nodeName, filePath, history, map, provider, signal }),
    );
  } catch (error) {
    return aiErrorResponse(error, "La IA no devolvió una respuesta válida.", "api/lesson/chat");
  }
  if (reply.format !== "lesson") return Response.json({ answer: reply.answer, evidence: reply.evidence });

  // El modelo pidió un recorrido guiado: se genera aquí para que el cliente reciba texto y pasos juntos.
  // Si la lección falla, el texto ya es una respuesta válida por sí solo.
  try {
    const goal = reply.lessonGoal || question;
    const lesson = await runWithDeadline(request, provider, LESSON_TIMEOUT_MS, (signal) =>
      generateLesson({ goal, map, provider, signal }),
    );
    return Response.json({ answer: reply.answer, lesson });
  } catch (error) {
    if (error instanceof AiError && error.code === "aborted") {
      return aiErrorResponse(error, "La IA no devolvió una respuesta válida.", "api/lesson/chat");
    }
    console.warn("[api/lesson/chat] no se pudo generar la lección; se devuelve solo el texto", error);
    return Response.json({ answer: reply.answer });
  }
}

function readHistory(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.content !== "string") return null;
    if (item.role !== "user" && item.role !== "assistant") return null;
    turns.push({ role: item.role, content: item.content });
  }
  return turns;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
