import type { LessonSession } from "../types";

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "ahora mismo";
}

/** Lo último que se preguntó; si solo existe la lección inicial, su título. */
export function sessionExcerpt(session: LessonSession): string {
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const message = session.history[index];
    if (message?.role === "user" && index > 0) return message.content;
  }
  const first = session.history.find((message) => message.role === "assistant");
  return first?.lesson?.title ?? session.history[0]?.content ?? "";
}

/** Hay seguimiento cuando la conversación pasó del par pregunta + lección. */
export function hasFollowUps(session: LessonSession): boolean {
  return session.history.length > 2;
}
