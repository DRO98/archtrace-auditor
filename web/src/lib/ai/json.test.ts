import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderJson, repairTruncatedJson } from "./json";
import { AiError } from "./types";

test("repairTruncatedJson cierra una cadena cortada", () => {
  assert.deepEqual(repairTruncatedJson('{"answer": "Hola mund'), { answer: "Hola mund" });
});

test("repairTruncatedJson descarta la clave a medias y cierra listas y objetos", () => {
  assert.deepEqual(repairTruncatedJson('{"a": [1, 2], "b": {"c": 3, "d'), { a: [1, 2], b: { c: 3 } });
  assert.deepEqual(repairTruncatedJson('{"a": 1, "b":'), { a: 1 });
  assert.deepEqual(repairTruncatedJson('```json\n{"steps": [{"n": 1}, {"n": 2, "title": "x'), {
    steps: [{ n: 1 }, { n: 2, title: "x" }],
  });
});

test("repairTruncatedJson no deja un escape colgando", () => {
  assert.deepEqual(repairTruncatedJson('{"answer": "linea\\'), { answer: "linea" });
});

test("repairTruncatedJson devuelve null sin objeto", () => {
  assert.equal(repairTruncatedJson("lo siento, no puedo"), null);
});

test("parseProviderJson repara solo si el proveedor avisó de truncado", () => {
  assert.deepEqual(parseProviderJson('{"answer": "corta', "groq", "length"), { answer: "corta" });
  assert.throws(
    () => parseProviderJson('{"answer": "corta', "groq", "stop"),
    (error: unknown) => error instanceof AiError && error.code === "bad_response",
  );
});
