import assert from "node:assert/strict";
import test from "node:test";
import { parseIdeMessage } from "./protocol";

function frame(payload: unknown): string {
  return JSON.stringify({ protocol: "TEACHER_CANVAS_v1", action: "SOURCE_FILES_CHANGED", payload });
}

test("SOURCE_FILES_CHANGED válido se parsea y deduplica rutas", () => {
  const message = parseIdeMessage(
    frame({ changedPaths: ["src/rag/chunker.py", "src/rag/chunker.py", "src/app.ts"], changedAt: "2026-09-26T10:00:00.000Z" }),
  );
  assert.deepEqual(message, {
    protocol: "TEACHER_CANVAS_v1",
    action: "SOURCE_FILES_CHANGED",
    payload: { changedPaths: ["src/rag/chunker.py", "src/app.ts"], changedAt: "2026-09-26T10:00:00.000Z" },
  });
});

test("SOURCE_FILES_CHANGED rechaza rutas absolutas, con .. o backslashes, listas vacías y fechas inválidas", () => {
  const at = "2026-09-26T10:00:00.000Z";
  const invalid: unknown[] = [
    { changedPaths: [], changedAt: at },
    { changedPaths: ["/etc/passwd"], changedAt: at },
    { changedPaths: ["C:/Windows/x.py"], changedAt: at },
    { changedPaths: ["src/../../secret.py"], changedAt: at },
    { changedPaths: ["src\\rag\\chunker.py"], changedAt: at },
    { changedPaths: [42], changedAt: at },
    { changedPaths: ["src/a.py"], changedAt: "ayer" },
    { changedPaths: ["src/a.py"] },
    "basura",
  ];
  for (const payload of invalid) {
    assert.equal(parseIdeMessage(frame(payload)), null, JSON.stringify(payload));
  }
});
