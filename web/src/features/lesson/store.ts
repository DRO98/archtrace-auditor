"use client";

import { create } from "zustand";
import type { Lesson } from "@core/lesson";
import type { ProjectMap } from "@core/projectMap";
import { fetchProjectMap } from "@/hooks/useTeacherSocket";
import { useCanvasStore } from "@/features/canvas/store";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import {
  assistantMessage,
  createChatSession,
  createSession,
  sessionLesson,
  toChatTurns,
  type SessionNode,
} from "@/features/history/lib/sessionNode";
import * as sessionStore from "@/features/history/lib/sessionStorage";
import type { AnswerEvidence, LessonSession } from "@/features/history/types";
import type { AiSelection } from "@/lib/ai/types";
import { aiSelection } from "@/lib/ai/settings";
import { networkErrorMessage, postJson, readApiError } from "@/lib/http";
import { sameSourceFile } from "@/features/canvas/lib/sourceSync";
import { invalidateLessonsForFiles, lessonCacheKey, lessonTouches, readCachedLesson, writeCachedLesson } from "./lib/cache";

export type LessonStatus = "idle" | "scanning" | "answering" | "writing" | "ready" | "error";
/** `chat`: respuesta en texto libre. `lesson`: recorrido guiado por pasos sobre el código. */
export type AskMode = "chat" | "lesson";
export type ChatStatus = "idle" | "sending";

interface LessonUiState {
  projectMap: ProjectMap | null;
  status: LessonStatus;
  chatStatus: ChatStatus;
  /** Conversación abierta en el panel. */
  session: LessonSession | null;
  /** Nodo de un chat en blanco que todavía no tiene mensajes. */
  draftNode: SessionNode | null;
  /** Historial del proyecto actual, más reciente primero. Varias sesiones pueden compartir `nodeId`. */
  sessions: LessonSession[];
  activeStep: number;
  error: string | null;
  /** Código del último error de la API (`auth`, `unconfigured`, `timeout`…): decide qué acción ofrece el panel. */
  errorCode: string | null;
  ask: (goal: string, node: SessionNode, mode?: AskMode) => Promise<void>;
  followUp: (question: string) => Promise<void>;
  cancel: () => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  closeLesson: () => void;
  /**
   * Vuelve a pedir el mapa al IDE. Con `quiet` no toca el estado del panel (sirve para refrescos en segundo
   * plano) y los errores se lanzan al llamador en lugar de mostrarse en el panel.
   */
  refreshMap: (options?: { quiet?: boolean }) => Promise<ProjectMap | null>;
  /**
   * El código de estos archivos cambió en el IDE: borra las lecciones en caché que los citan y cierra la
   * sesión abierta si trata de ellos (sigue en el historial; al volver a preguntar se regenera).
   */
  invalidateSources: (changedPaths: readonly string[]) => void;
  loadSessions: () => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => void;
  deleteModuleSessions: (nodeId: string | null) => void;
  renameSession: (id: string, title: string) => void;
  startBlank: (node: SessionNode) => void;
}

let inflight: AbortController | null = null;

export const useLessonStore = create<LessonUiState>((set, get) => ({
  projectMap: null,
  status: "idle",
  chatStatus: "idle",
  session: null,
  draftNode: null,
  sessions: [],
  activeStep: 0,
  error: null,
  errorCode: null,
  ask: async (goal, node, mode = "chat") => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    const controller = restartInflight();
    set({ status: "scanning", error: null, errorCode: null });
    try {
      const map = await ensureMap(get, set);
      if (controller.signal.aborted) return;

      if (mode === "chat") {
        set({ status: "answering" });
        const response = await postJson(
          "/api/lesson/chat",
          { question: trimmed, node: { nodeName: node.nodeName, filePath: node.filePath }, history: [], map, ai: aiSelection() },
          controller.signal,
        );
        const reply = response.ok ? readReply(response.body) : null;
        if (!reply) {
          const failure = readApiError(response, "La IA no devolvió una respuesta válida.");
          set({ status: "error", error: failure.message, errorCode: failure.code });
          return;
        }
        const session = createChatSession(projectId(), node, trimmed, reply.answer, reply.lesson, Date.now(), reply.evidence);
        sessionStore.saveSession(session);
        set({ session, draftNode: null, activeStep: 0, status: "ready", sessions: sessionStore.listSessions(projectId()) });
        focusStep(reply.lesson, 0);
        return;
      }

      set({ status: "writing" });

      const ai = aiSelection();
      const { provider, model } = await readAiStatus(ai);
      const cacheKey = provider ? lessonCacheKey(`${node.nodeId ?? ""}|${trimmed}`, map, provider, model) : null;
      let lesson = cacheKey ? readCachedLesson(cacheKey) : null;

      if (!lesson) {
        const response = await postJson("/api/lesson", { goal: trimmed, map, ai }, controller.signal);
        if (!response.ok) {
          const failure = readApiError(response, "La IA no devolvió una lección válida.");
          set({ status: "error", error: failure.message, errorCode: failure.code });
          return;
        }
        lesson = readLesson(response.body);
        if (!lesson) {
          set({ status: "error", error: "La IA no devolvió una lección válida." });
          return;
        }
        if (cacheKey) writeCachedLesson(cacheKey, lesson);
      }

      const session = createSession(projectId(), node, trimmed, lesson);
      sessionStore.saveSession(session);
      set({ session, draftNode: null, activeStep: 0, status: "ready", sessions: sessionStore.listSessions(projectId()) });
      focusStep(lesson, 0);
    } catch (error) {
      if (controller.signal.aborted) {
        set({ status: get().session ? "ready" : "idle" });
        return;
      }
      const fallback = mode === "chat" ? "No se pudo enviar la pregunta." : "No se pudo generar la lección.";
      set({ status: "error", error: networkErrorMessage(error, fallback), errorCode: null });
    }
  },
  followUp: async (question) => {
    const trimmed = question.trim();
    const current = get().session;
    if (!trimmed || !current) return;
    const controller = restartInflight();
    const asked: LessonSession = {
      ...current,
      history: [...current.history, { role: "user", content: trimmed, createdAt: Date.now() }],
      timestamp: Date.now(),
    };
    sessionStore.saveSession(asked);
    set({ session: asked, chatStatus: "sending", error: null, errorCode: null });

    try {
      const map = await ensureMap(get, set);
      const response = await postJson(
        "/api/lesson/chat",
        {
          question: trimmed,
          node: { nodeName: current.nodeName, filePath: current.filePath },
          history: toChatTurns(current.history),
          map,
          ai: aiSelection(),
        },
        controller.signal,
      );
      const reply = response.ok ? readReply(response.body) : null;
      if (!reply) {
        rollback(current, readApiError(response, "La IA no devolvió una respuesta válida."));
        return;
      }
      const now = Date.now();
      const message = assistantMessage(reply.answer, reply.lesson, reply.evidence, now);
      // Si mientras tanto se abrió otra sesión, se guarda igual pero no se pisa el panel.
      const answered: LessonSession = { ...asked, history: [...asked.history, message], timestamp: now };
      sessionStore.saveSession(answered);
      const visible = get().session?.id === answered.id;
      set((state) => ({
        chatStatus: "idle",
        session: visible ? answered : state.session,
        activeStep: visible && reply.lesson ? 0 : state.activeStep,
        sessions: sessionStore.listSessions(projectId()),
      }));
      if (visible && reply.lesson) focusStep(reply.lesson, 0);
    } catch (error) {
      if (controller.signal.aborted) {
        rollback(current, null);
        return;
      }
      rollback(current, { message: networkErrorMessage(error, "No se pudo enviar la pregunta."), code: null });
    }

    /** Sin respuesta la pregunta no queda en el historial: el panel conserva el texto para reintentar. */
    function rollback(previous: LessonSession, failure: { message: string; code: string | null } | null): void {
      sessionStore.saveSession(previous);
      set((state) => ({
        chatStatus: "idle",
        error: failure?.message ?? null,
        errorCode: failure?.code ?? null,
        session: state.session?.id === previous.id ? previous : state.session,
      }));
    }
  },
  cancel: () => {
    inflight?.abort();
    inflight = null;
    set((state) => ({ status: state.session ? "ready" : "idle", chatStatus: "idle" }));
  },
  goTo: (index) => {
    const lesson = sessionLesson(get().session);
    if (!lesson || index < 0 || index >= lesson.steps.length) return;
    set({ activeStep: index });
    focusStep(lesson, index);
  },
  next: () => get().goTo(get().activeStep + 1),
  prev: () => get().goTo(get().activeStep - 1),
  closeLesson: () => {
    inflight?.abort();
    useCanvasStore.getState().setLessonFocus(new Set());
    set({ session: null, draftNode: null, activeStep: 0, status: "idle", chatStatus: "idle", error: null, errorCode: null });
  },
  refreshMap: async (options) => {
    const quiet = options?.quiet === true;
    if (!quiet) set({ status: "scanning", error: null, errorCode: null });
    try {
      const map = await fetchProjectMap();
      if (quiet) set({ projectMap: map });
      else set({ projectMap: map, status: get().session ? "ready" : "idle" });
      return map;
    } catch (error) {
      if (quiet) throw error;
      set({ status: "error", error: error instanceof Error ? error.message : "No se pudo leer el mapa." });
      return null;
    }
  },
  invalidateSources: (changedPaths) => {
    invalidateLessonsForFiles(changedPaths);
    const { session, chatStatus, status } = get();
    // No se interrumpe una respuesta o una lección que se está escribiendo.
    if (!session || chatStatus === "sending" || status === "scanning" || status === "answering" || status === "writing") return;
    const onFile = session.filePath !== null && changedPaths.some((changed) => sameSourceFile(changed, session.filePath ?? ""));
    const lesson = sessionLesson(session);
    if (onFile || (lesson && lessonTouches(lesson, changedPaths))) get().closeLesson();
  },
  loadSessions: () => set({ sessions: sessionStore.listSessions(projectId()) }),
  openSession: (id) => {
    const session = sessionStore.readSession(id);
    if (!session) {
      get().loadSessions();
      return;
    }
    inflight?.abort();
    set({ session, draftNode: null, activeStep: 0, status: "ready", chatStatus: "idle", error: null, errorCode: null });
    // El drawer se abre sobre el nodo exacto (o sin nodo, para sesiones del proyecto).
    useCanvasStore.setState((state) => ({
      view: "architecture",
      drawer: { open: true, tab: "lesson", moduleId: session.nodeId },
      selectedModuleId: session.nodeId ?? state.selectedModuleId,
      selectedSubBlockId: null,
    }));
    const lesson = sessionLesson(session);
    if (lesson) focusStep(lesson, 0);
  },
  deleteSession: (id) => {
    sessionStore.deleteSession(id);
    set((state) => ({
      sessions: sessionStore.listSessions(projectId()),
      session: state.session?.id === id ? null : state.session,
    }));
  },
  deleteModuleSessions: (nodeId) => {
    sessionStore.deleteSessionsForModule(projectId(), nodeId);
    set((state) => ({
      sessions: sessionStore.listSessions(projectId()),
      session: state.session?.nodeId === nodeId ? null : state.session,
      draftNode: state.draftNode?.nodeId === nodeId ? null : state.draftNode,
    }));
  },
  renameSession: (id, title) => {
    const renamed = sessionStore.renameSession(id, title);
    if (!renamed) return;
    set((state) => ({
      sessions: sessionStore.listSessions(projectId()),
      session: state.session?.id === renamed.id ? renamed : state.session,
    }));
  },
  startBlank: (node) => {
    inflight?.abort();
    inflight = null;
    useCanvasStore.getState().setLessonFocus(new Set());
    set({
      session: null,
      draftNode: node,
      activeStep: 0,
      status: "idle",
      chatStatus: "idle",
      error: null,
      errorCode: null,
    });
    useCanvasStore.setState((state) => ({
      view: "architecture",
      drawer: { open: true, tab: "lesson", moduleId: node.nodeId },
      selectedModuleId: node.nodeId ?? state.selectedModuleId,
      selectedSubBlockId: null,
    }));
  },
}));

function restartInflight(): AbortController {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  return controller;
}

async function ensureMap(
  get: () => LessonUiState,
  set: (partial: Partial<LessonUiState>) => void,
): Promise<ProjectMap> {
  const existing = get().projectMap;
  if (existing) return existing;
  const map = await fetchProjectMap();
  set({ projectMap: map });
  return map;
}

function projectId(): string {
  return useCanvasStore.getState().graph?.projectName ?? "default";
}

function focusStep(lesson: Lesson | null, index: number): void {
  const step = lesson?.steps[index];
  if (!step) {
    useCanvasStore.getState().setLessonFocus(new Set());
    return;
  }
  syncEditorTo(
    { filePath: step.codeRef.filePath, line: step.codeRef.startLine, endLine: step.codeRef.endLine },
    { allowDeepLink: false },
  );
  useCanvasStore.getState().setLessonFocus(new Set([step.codeRef.filePath]));
}

/** Proveedor y modelo que resolverá el servidor con esta selección: forman parte de la clave de caché. */
async function readAiStatus(ai: AiSelection | undefined): Promise<{ provider: string | null; model: string }> {
  const { body } = await postJson("/api/ai/status", { ai });
  if (typeof body !== "object" || body === null || !("configured" in body) || body.configured !== true) {
    return { provider: null, model: "default" };
  }
  const provider = "provider" in body && typeof body.provider === "string" ? body.provider : null;
  const model = "model" in body && typeof body.model === "string" ? body.model : "default";
  return { provider, model };
}

/** Respuesta del chat: texto siempre, y una lección guiada cuando el modelo decidió que la pregunta la pedía. */
const EVIDENCE: ReadonlySet<unknown> = new Set<AnswerEvidence>(["cited", "theory", "not-in-map", "missing"]);

function readReply(body: unknown): { answer: string; lesson: Lesson | null; evidence: AnswerEvidence | null } | null {
  if (typeof body !== "object" || body === null || !("answer" in body)) return null;
  if (typeof body.answer !== "string" || !body.answer.trim()) return null;
  const evidence = "evidence" in body && EVIDENCE.has(body.evidence) ? (body.evidence as AnswerEvidence) : null;
  return { answer: body.answer, lesson: readLesson(body), evidence };
}

function readLesson(body: unknown): Lesson | null {
  if (typeof body !== "object" || body === null || !("lesson" in body)) return null;
  const lesson = body.lesson;
  if (typeof lesson !== "object" || lesson === null) return null;
  const record = lesson as Lesson;
  if (typeof record.title !== "string" || !Array.isArray(record.steps)) return null;
  return record;
}
