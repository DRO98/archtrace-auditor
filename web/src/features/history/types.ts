import type { ModuleRole } from "@core/graph";
import type { Lesson } from "@core/lesson";

export type ChatRole = "user" | "assistant";

export interface UserMessage {
  role: "user";
  content: string;
  createdAt: number;
}

/**
 * Cuánto respaldo tiene en el mapa una respuesta del chat:
 * `cited` (≥ 1 cita `ruta:línea` válida), `theory` (teoría general, no afirma nada del proyecto),
 * `not-in-map` (la propia respuesta admite que el mapa no lo muestra) o `missing` (habla del proyecto sin citas válidas).
 */
export type AnswerEvidence = "cited" | "theory" | "not-in-map" | "missing";

export interface AssistantMessage {
  role: "assistant";
  content: string;
  createdAt: number;
  /** La lección guiada (pasos + codeRefs) cuando la respuesta es un recorrido por el código. */
  lesson?: Lesson;
  /** Ausente en recorridos guiados (sus pasos ya se validan) y en sesiones guardadas antes de existir el campo. */
  evidence?: AnswerEvidence;
}

export type ChatMessage = UserMessage | AssistantMessage;

/** Lo que viaja al modelo: sin lecciones ni fechas. */
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Una conversación ligada a un nodo del diagrama (o al proyecto entero si `nodeId` es null). */
export interface LessonSession {
  version: 1;
  id: string;
  /** `CodeGraph.projectName`: el historial se filtra por proyecto. */
  projectId: string;
  nodeId: string | null;
  nodeName: string;
  nodeRole: ModuleRole;
  /** Hex de `ROLE_TONE[nodeRole]` en el momento de guardar (el render usa el tono vivo). */
  nodeColor: string;
  filePath: string | null;
  /** Línea de la definición del nodo; la usa "Ver código" y el deep link. */
  line: number | null;
  /** Primer prompt del usuario, recortado. Se puede cambiar con Renombrar. */
  title: string;
  history: ChatMessage[];
  createdAt: number;
  /** Última actividad; ordena el historial. */
  timestamp: number;
}

/** Contexto del nodo que el cliente manda al endpoint de chat. */
export interface ChatNodeContext {
  nodeName: string;
  filePath: string | null;
}
