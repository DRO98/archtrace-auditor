import type { CodeModule, ModuleRole } from "@core/graph";
import type { Lesson } from "@core/lesson";
import { inferRole } from "@/features/canvas/lib/architecture";
import { moduleRange } from "@/features/canvas/lib/graph";
import { ROLE_TONE } from "@/features/canvas/theme";
import type { AnswerEvidence, AssistantMessage, ChatMessage, ChatTurn, LessonSession } from "../types";
import { titleFromPrompt } from "./sessionStorage";

/** Lo que una sesión necesita saber del nodo que la originó. */
export interface SessionNode {
  nodeId: string | null;
  nodeName: string;
  nodeRole: ModuleRole;
  filePath: string | null;
  line: number | null;
}

export function sessionNodeFor(codeModule: CodeModule | null, projectName: string): SessionNode {
  if (!codeModule) {
    return { nodeId: null, nodeName: projectName, nodeRole: "app", filePath: null, line: null };
  }
  return {
    nodeId: codeModule.id,
    nodeName: codeModule.label,
    nodeRole: codeModule.role ?? inferRole(codeModule),
    filePath: codeModule.filePath,
    line: moduleRange(codeModule)?.startLine ?? null,
  };
}

export function sessionNodeFrom(
  session: Pick<LessonSession, "nodeId" | "nodeName" | "nodeRole" | "filePath" | "line">,
): SessionNode {
  return {
    nodeId: session.nodeId,
    nodeName: session.nodeName,
    nodeRole: session.nodeRole,
    filePath: session.filePath,
    line: session.line,
  };
}

export function createSession(
  projectId: string,
  node: SessionNode,
  goal: string,
  lesson: Lesson,
  now: number = Date.now(),
): LessonSession {
  return newSession(projectId, node, goal, [
    { role: "user", content: goal, createdAt: now },
    { role: "assistant", content: lesson.overview, createdAt: now, lesson },
  ], now);
}

/** Sesión de chat libre: la primera respuesta es texto, con lección guiada solo si el modelo eligió ese formato. */
export function createChatSession(
  projectId: string,
  node: SessionNode,
  question: string,
  answer: string,
  lesson: Lesson | null,
  now: number = Date.now(),
  evidence: AnswerEvidence | null = null,
): LessonSession {
  return newSession(projectId, node, question, [
    { role: "user", content: question, createdAt: now },
    assistantMessage(answer, lesson, evidence, now),
  ], now);
}

/** Respuesta del mentor: con lección si es un recorrido guiado, con `evidence` si pasó por el filtro de citas. */
export function assistantMessage(answer: string, lesson: Lesson | null, evidence: AnswerEvidence | null, now: number = Date.now()): AssistantMessage {
  const message: AssistantMessage = { role: "assistant", content: answer, createdAt: now };
  if (lesson) message.lesson = lesson;
  if (evidence) message.evidence = evidence;
  return message;
}

function newSession(projectId: string, node: SessionNode, prompt: string, history: ChatMessage[], now: number): LessonSession {
  return {
    version: 1,
    id: `s_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    ...node,
    nodeColor: ROLE_TONE[node.nodeRole].hex,
    title: titleFromPrompt(prompt),
    history,
    createdAt: now,
    timestamp: now,
  };
}

/** La lección más reciente de la sesión: es la que manejan los botones de paso y el foco del editor. */
export function sessionLesson(session: LessonSession | null): Lesson | null {
  if (!session) return null;
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const message = session.history[index];
    if (message?.role === "assistant" && message.lesson) return message.lesson;
  }
  return null;
}

/** Aplana el historial para el modelo: la lección inicial viaja como texto con sus pasos. */
export function toChatTurns(history: readonly ChatMessage[]): ChatTurn[] {
  return history.map((message) => {
    if (message.role === "assistant" && message.lesson) {
      const { title, overview, steps } = message.lesson;
      const lines = steps.map(
        (step) =>
          `${step.stepNumber}. ${step.title}: ${step.summary} (${step.codeRef.filePath}:${step.codeRef.startLine}-${step.codeRef.endLine})`,
      );
      return { role: "assistant", content: [title, overview, "Pasos:", ...lines].join("\n") };
    }
    return { role: message.role, content: message.content };
  });
}
