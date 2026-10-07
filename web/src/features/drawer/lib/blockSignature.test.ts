import assert from "node:assert/strict";
import test from "node:test";
import { dataFlowOf, signatureOf } from "./blockSignature";

test("firma por lenguaje", () => {
  assert.equal(signatureOf({ kind: "function", name: "handle_request" }, "python"), "def handle_request(…)");
  assert.equal(signatureOf({ kind: "function", name: "loadGraph" }, "typescript"), "function loadGraph(…)");
  assert.equal(signatureOf({ kind: "method", name: "save" }, "typescript"), "save(…)");
  assert.equal(signatureOf({ kind: "class", name: "VectorStore" }, "python"), "class VectorStore");
});

test("dirección de datos", () => {
  assert.deepEqual(dataFlowOf({ kind: "function", name: "handle_request" }, "api"), { input: "Request HTTP", output: "JSON Response" });
  assert.deepEqual(dataFlowOf({ kind: "function", name: "embedTexts" }, "ai-model"), { input: "Texto", output: "Vector" });
  assert.deepEqual(dataFlowOf({ kind: "method", name: "__init__" }, "service"), { input: "Argumentos", output: "Instancia" });
  assert.deepEqual(dataFlowOf({ kind: "function", name: "LessonPanel" }, "ui"), { input: "Props", output: "UI (JSX)" });
  assert.equal(dataFlowOf({ kind: "function", name: "useLessonStore" }, "ui"), null);
  assert.equal(dataFlowOf({ kind: "class", name: "Store" }, "database"), null);
  assert.equal(dataFlowOf({ kind: "function", name: "zork" }, "code"), null);
});
