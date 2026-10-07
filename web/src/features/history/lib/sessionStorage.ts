import type { ChatMessage, LessonSession } from "../types";

const STORAGE_KEY_V1 = "tc:sessions:v1";
const STORAGE_KEY_V2 = "tc:sessions:v2";
const MAX_SESSIONS = 200;
const MAX_MESSAGES = 60;
const TITLE_LIMIT = 72;

/** Clave de agrupación: el nodo, o el proyecto entero si la lección no tiene módulo. */
export const PROJECT_MODULE_KEY = "project";

export interface ModuleGroup {
  moduleKey: string;
  nodeId: string | null;
  latest: LessonSession;
  count: number;
}

export function moduleKey(nodeId: string | null): string {
  return nodeId ?? PROJECT_MODULE_KEY;
}

/** Título automático: el primer prompt, en una sola línea y recortado. */
export function titleFromPrompt(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (!collapsed) return "Hilo sin título";
  if (collapsed.length <= TITLE_LIMIT) return collapsed;
  return `${collapsed.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

export function listSessions(projectId: string): LessonSession[] {
  return readAll()
    .filter((session) => session.projectId === projectId)
    .sort((left, right) => right.timestamp - left.timestamp);
}

export function listSessionsForModule(projectId: string, nodeId: string | null): LessonSession[] {
  return listSessions(projectId).filter((session) => session.nodeId === nodeId);
}

/** Una entrada por módulo. `sessions` debe llegar ya ordenado de más reciente a más antiguo. */
export function groupSessions(sessions: readonly LessonSession[]): ModuleGroup[] {
  const groups: ModuleGroup[] = [];
  const index = new Map<string, ModuleGroup>();
  for (const session of sessions) {
    const key = moduleKey(session.nodeId);
    const existing = index.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const group: ModuleGroup = { moduleKey: key, nodeId: session.nodeId, latest: session, count: 1 };
    index.set(key, group);
    groups.push(group);
  }
  return groups;
}

/** Una entrada por módulo, de la actividad más reciente a la más antigua. */
export function listModuleGroups(projectId: string): ModuleGroup[] {
  return groupSessions(listSessions(projectId));
}

export function readSession(id: string): LessonSession | null {
  return readAll().find((session) => session.id === id) ?? null;
}

export function saveSession(session: LessonSession): void {
  const trimmed: LessonSession = { ...session, history: trimHistory(session.history) };
  const all = readAll().filter((item) => item.id !== session.id);
  all.unshift(trimmed);
  all.sort((left, right) => right.timestamp - left.timestamp);
  writeAll(all.slice(0, MAX_SESSIONS));
}

export function renameSession(id: string, title: string, now: number = Date.now()): LessonSession | null {
  const current = readSession(id);
  if (!current) return null;
  const trimmed = title.trim();
  if (!trimmed) return current;
  const next: LessonSession = { ...current, title: trimmed, timestamp: now };
  saveSession(next);
  return next;
}

export function deleteSession(id: string): void {
  writeAll(readAll().filter((session) => session.id !== id));
}

export function deleteSessionsForModule(projectId: string, nodeId: string | null): void {
  writeAll(readAll().filter((session) => !(session.projectId === projectId && session.nodeId === nodeId)));
}

/** Conserva siempre el primer turno (la lección) y recorta los intermedios más viejos. */
export function trimHistory(history: readonly ChatMessage[]): ChatMessage[] {
  if (history.length <= MAX_MESSAGES) return [...history];
  return [...history.slice(0, 2), ...history.slice(history.length - (MAX_MESSAGES - 2))];
}

function writeAll(sessions: LessonSession[]): void {
  const record: Record<string, LessonSession> = {};
  for (const session of sessions) record[session.id] = session;
  const file = { version: 2 as const, sessions: record };
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(file));
    localStorage.removeItem(STORAGE_KEY_V1);
  } catch {
    // Un almacenamiento lleno o bloqueado no debe romper la conversación.
  }
}

function readAll(): LessonSession[] {
  try {
    const modern = localStorage.getItem(STORAGE_KEY_V2);
    if (modern !== null) return parseV2(modern);
    const legacy = localStorage.getItem(STORAGE_KEY_V1);
    if (legacy === null) return [];
    const sessions = parseV1(legacy);
    writeAll(sessions);
    return sessions;
  } catch {
    return [];
  }
}

function parseV2(raw: string): LessonSession[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  if (record.version !== 2 || typeof record.sessions !== "object" || record.sessions === null || Array.isArray(record.sessions)) {
    return [];
  }
  return Object.values(record.sessions).map(normalizeSession).filter((session): session is LessonSession => session !== null);
}

function parseV1(raw: string): LessonSession[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeSession).filter((session): session is LessonSession => session !== null);
}

function normalizeSession(value: unknown): LessonSession | null {
  if (!isSessionShape(value)) return null;
  const session = value as LessonSession;
  const rawTitle = (value as { title?: unknown }).title;
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : titleFromFirstPrompt(session.history);
  return { ...session, title };
}

function titleFromFirstPrompt(history: readonly ChatMessage[]): string {
  const firstUser = history.find((message) => message.role === "user");
  return titleFromPrompt(firstUser?.content ?? "");
}

function isSessionShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.id === "string" &&
    typeof record.projectId === "string" &&
    (record.nodeId === null || typeof record.nodeId === "string") &&
    typeof record.nodeName === "string" &&
    typeof record.nodeRole === "string" &&
    typeof record.nodeColor === "string" &&
    (record.filePath === null || typeof record.filePath === "string") &&
    (record.line === null || typeof record.line === "number") &&
    typeof record.createdAt === "number" &&
    typeof record.timestamp === "number" &&
    Array.isArray(record.history) &&
    record.history.every(isMessage)
  );
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string" &&
    typeof record.createdAt === "number"
  );
}
