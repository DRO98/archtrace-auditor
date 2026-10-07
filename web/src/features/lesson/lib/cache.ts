import type { Lesson } from "@core/lesson";
import type { ProjectMap } from "@core/projectMap";
import { sameSourceFile } from "@/features/canvas/lib/sourceSync";

const STORAGE_KEY = "tc:lessons:v1";
const MAX_LESSONS = 20;

export function lessonCacheKey(goal: string, map: ProjectMap, provider: string, model: string): string {
  const normalized = goal.trim().toLowerCase().replace(/\s+/g, " ");
  return `${hash(normalized)}:${map.revision}:${provider}:${model}`;
}

export function readCachedLesson(key: string): Lesson | null {
  const all = readAll();
  return all.find((item) => item.key === key)?.lesson ?? null;
}

export function writeCachedLesson(key: string, lesson: Lesson): void {
  const all = readAll().filter((item) => item.key !== key);
  all.unshift({ key, lesson, savedAt: Date.now() });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_LESSONS)));
  } catch {
    // A full or blocked store must not break the lesson.
  }
}

/** Borra las lecciones guardadas que apuntan a alguno de estos archivos. Devuelve cuántas se borraron. */
export function invalidateLessonsForFiles(changedPaths: readonly string[]): number {
  const all = readAll();
  const kept = all.filter((item) => !lessonTouches(item.lesson, changedPaths));
  const removed = all.length - kept.length;
  if (removed === 0) return 0;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Si no se puede escribir, la revisión del mapa ya invalida la clave de todos modos.
  }
  return removed;
}

export function lessonTouches(lesson: Lesson, changedPaths: readonly string[]): boolean {
  return lesson.steps.some((step) =>
    changedPaths.some((changed) => typeof step.codeRef?.filePath === "string" && sameSourceFile(changed, step.codeRef.filePath)),
  );
}

interface StoredLesson {
  key: string;
  lesson: Lesson;
  savedAt: number;
}

function readAll(): StoredLesson[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStored);
  } catch {
    return [];
  }
}

function isStored(value: unknown): value is StoredLesson {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.key === "string" && typeof record.savedAt === "number" && isLesson(record.lesson);
}

function isLesson(value: unknown): value is Lesson {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string" && Array.isArray(record.steps);
}

function hash(value: string): string {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0).toString(16);
}
