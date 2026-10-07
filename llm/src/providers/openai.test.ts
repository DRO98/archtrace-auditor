import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestError } from "openai";
import { isJsonValidateFailed, jsonInstruction, readFailedGeneration } from "./openai";

function groqJsonError(failedGeneration?: string): BadRequestError {
  return new BadRequestError(
    400,
    {
      message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      failed_generation: failedGeneration,
    },
    undefined,
    new Headers(),
  );
}

test("detecta el 400 json_validate_failed de Groq", () => {
  assert.equal(isJsonValidateFailed(groqJsonError()), true);
  assert.equal(isJsonValidateFailed(new BadRequestError(400, { message: "otro error" }, undefined, new Headers())), false);
  assert.equal(isJsonValidateFailed(new Error("boom")), false);
});

test("recupera failed_generation para repararlo", () => {
  assert.equal(readFailedGeneration(groqJsonError('{"answer": "Hola mund')), '{"answer": "Hola mund');
  assert.equal(readFailedGeneration(groqJsonError()), null);
});

test("el prompt de modo JSON pide JSON explícitamente", () => {
  const text = jsonInstruction({ system: "", user: "", schema: { type: "object" }, schemaName: "lesson", maxTokens: 10 });
  assert.match(text, /Responde únicamente en formato JSON válido/);
  assert.match(text, /"type":"object"/);
});
