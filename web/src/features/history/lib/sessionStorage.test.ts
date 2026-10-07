import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  listModuleGroups,
  listSessions,
  listSessionsForModule,
  renameSession,
  saveSession,
  titleFromPrompt,
  type ModuleGroup,
} from "./sessionStorage";
import type { LessonSession } from "../types";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
});

test("titleFromPrompt colapsa espacios y recorta a 72 caracteres", () => {
  assert.equal(titleFromPrompt("  hola   mundo  "), "hola mundo");
  assert.equal(titleFromPrompt("   "), "Hilo sin título");
  const long = "a".repeat(80);
  const title = titleFromPrompt(long);
  assert.equal(title.length, 72);
  assert.ok(title.endsWith("…"));
  assert.equal(title.slice(0, -1), "a".repeat(71));
});

test("migra el array v1 y asigna el título desde el primer prompt", () => {
  const legacy = stored({
    id: "s_legacy",
    history: [
      { role: "user", content: "  Explícame   el pipeline de preguntas  ", createdAt: 10 },
      { role: "assistant", content: "Va así.", createdAt: 11 },
    ],
  });
  delete (legacy as { title?: string }).title;
  memory.set("tc:sessions:v1", JSON.stringify([legacy]));

  const listed = listSessions("sandbox");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.title, "Explícame el pipeline de preguntas");
  assert.equal(memory.get("tc:sessions:v1"), undefined);

  const saved = JSON.parse(memory.get("tc:sessions:v2") ?? "") as {
    version: number;
    sessions: Record<string, LessonSession>;
  };
  assert.equal(saved.version, 2);
  assert.equal(saved.sessions.s_legacy?.title, "Explícame el pipeline de preguntas");
});

test("agrupa varias sesiones del mismo módulo y conserva el orden reciente", () => {
  saveSession(session({ id: "b1", nodeId: "mod-b", timestamp: 1, title: "B antigua" }));
  saveSession(session({ id: "a1", nodeId: "mod-a", timestamp: 2, title: "A antigua" }));
  saveSession(session({ id: "a2", nodeId: "mod-a", timestamp: 3, title: "A reciente" }));

  const groups = listModuleGroups("sandbox");
  assert.deepEqual(
    groups.map((group: ModuleGroup) => [group.nodeId, group.count, group.latest.id]),
    [
      ["mod-a", 2, "a2"],
      ["mod-b", 1, "b1"],
    ],
  );
  assert.deepEqual(
    listSessionsForModule("sandbox", "mod-a").map((item) => item.id),
    ["a2", "a1"],
  );
  assert.equal(listSessionsForModule("sandbox", null).length, 0);
});

test("renameSession cambia el título y la fecha de actividad", () => {
  saveSession(session({ id: "s1", title: "Antes", timestamp: 5 }));
  const renamed = renameSession("s1", "  Después  ", 90);
  assert.equal(renamed?.title, "Después");
  assert.equal(renamed?.timestamp, 90);
  assert.equal(listSessions("sandbox")[0]?.title, "Después");
  assert.equal(renameSession("s1", "   ")?.title, "Después");
  assert.equal(renameSession("missing", "Otro"), null);
});

function session(overrides: Partial<LessonSession> & Pick<LessonSession, "id">): LessonSession {
  return stored(overrides);
}

function stored(overrides: Partial<LessonSession> & Pick<LessonSession, "id">): LessonSession {
  return {
    version: 1,
    projectId: "sandbox",
    nodeId: "mod-a",
    nodeName: "Pipeline",
    nodeRole: "app",
    nodeColor: "#000",
    filePath: "src/app.py",
    line: 1,
    title: "Título",
    history: [{ role: "user", content: "Hola", createdAt: 1 }],
    createdAt: 1,
    timestamp: 1,
    ...overrides,
  };
}
