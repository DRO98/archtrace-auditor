import assert from "node:assert/strict";
import test from "node:test";
import { mapProviderError, statusForCode } from "./errors";

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

test("mapProviderError expone el 404 de Gemini sin enmascararlo como lección inválida", () => {
  const body = JSON.stringify({ error: { code: 404, message: "This model models/gemini-2.5-flash is no longer available.", status: "NOT_FOUND" } });
  const error = mapProviderError(httpError(404, body), "gemini");
  assert.equal(error.code, "provider");
  assert.notEqual(error.hint, "La IA no devolvió una lección válida.");
  assert.deepEqual(error.providerError, { status: 404, message: "This model models/gemini-2.5-flash is no longer available." });
  assert.equal(error.detail, "HTTP 404: This model models/gemini-2.5-flash is no longer available.");
  assert.equal(statusForCode(error.code), 502);
});

test("mapProviderError conserva estado y mensaje en 401 y 429", () => {
  const auth = mapProviderError(httpError(401, "API key not valid"), "gemini");
  assert.equal(auth.code, "auth");
  assert.deepEqual(auth.providerError, { status: 401, message: "API key not valid" });

  const limited = mapProviderError(httpError(429, "Resource exhausted"), "openai");
  assert.equal(limited.code, "rate_limit");
  assert.equal(limited.providerError?.status, 429);
  assert.equal(statusForCode(limited.code), 429);
});

test("mapProviderError nombra al proveedor elegido", () => {
  const auth = mapProviderError(httpError(401, "invalid x-api-key"), "anthropic");
  assert.match(auth.hint, /Anthropic/);
  const offline = mapProviderError(new Error("fetch failed"), "ollama");
  assert.equal(offline.code, "network");
  assert.match(offline.hint, /Ollama/);
});

test("mapProviderError trata 503 y 529 como indisponibilidad temporal", () => {
  const down = mapProviderError(httpError(503, "Service Unavailable"), "groq");
  assert.equal(down.code, "unavailable");
  assert.match(down.hint, /Groq no está disponible/);
  assert.equal(statusForCode(down.code), 503);
  assert.equal(mapProviderError(httpError(529, "overloaded_error"), "anthropic").code, "unavailable");
  assert.equal(statusForCode("timeout"), 504);
});

test("mapProviderError explica un 404 de modelo no disponible nombrando el modelo", () => {
  const error = mapProviderError(
    Object.assign(httpError(404, "404 The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."), { code: "model_not_found" }),
    "groq",
    "llama-3.3-70b-versatile",
  );
  assert.equal(error.code, "provider");
  assert.match(error.hint, /"llama-3\.3-70b-versatile" no existe en Groq/);
  assert.equal(error.providerError?.status, 404);
});

test("mapProviderError distingue cuota agotada de un 429 pasajero", () => {
  const openai = Object.assign(httpError(429, "You exceeded your current quota, please check your plan and billing details."), {
    code: "insufficient_quota",
  });
  assert.equal(mapProviderError(openai, "openai").code, "quota");
  assert.equal(mapProviderError(httpError(402, "Insufficient Balance"), "deepseek").code, "quota");
  assert.equal(mapProviderError(httpError(400, "Your credit balance is too low to access the Anthropic API."), "anthropic").code, "quota");
  assert.equal(mapProviderError(httpError(429, "Rate limit reached for requests"), "groq").code, "rate_limit");
  assert.equal(statusForCode("quota"), 402);
});
