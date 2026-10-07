import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectMap } from "@core/projectMap";
import type { AiProvider, CompleteJsonRequest } from "@/lib/ai/types";
import { answerFollowUp } from "./answerFollowUp";
import { assessEvidence, citationsIn, mapLineCounts, mentionsCode, validCitationCount } from "./evidence";

const map: ProjectMap = {
  version: 1,
  workspaceName: "demo",
  generatedAt: "2026-01-01T00:00:00Z",
  revision: "r1",
  truncated: false,
  stats: { files: 1, symbols: 1, skippedFiles: 0, unresolvedCalls: 0, ambiguousCalls: 0 },
  files: [
    {
      filePath: "src/app.ts",
      language: "typescript",
      lineCount: 40,
      imports: [],
      symbols: [
        {
          id: "main",
          kind: "function",
          name: "main",
          qualifiedName: "main",
          range: { startLine: 10, endLine: 20 },
          signature: "function main()",
          calls: [],
          instantiations: [],
        },
      ],
      moduleScope: { calls: [], instantiations: [] },
    },
  ],
};

test("citationsIn encuentra citas en párrafos y listas, no en bloques de código", () => {
  const cites = citationsIn("Arranca en `src/app.ts:10`.\n\n- ver src/app.ts:12-18\n\n```\nsrc/app.ts:30\n```");
  assert.deepEqual(
    cites.map((cite) => cite.raw),
    ["src/app.ts:10", "src/app.ts:12-18"],
  );
});

test("validCitationCount ignora rutas inventadas y líneas fuera de rango", () => {
  const files = mapLineCounts(map);
  assert.equal(validCitationCount("`src/app.ts:10` y `src/auth.ts:3` y `src/app.ts:90`", files), 1);
});

test("mentionsCode detecta rutas del mapa y cosas con forma de archivo de código", () => {
  assert.equal(mentionsCode("El auth está en `src/auth/service.ts`.", map), true);
  assert.equal(mentionsCode("Revisa app.ts para ver el arranque.", map), true);
  assert.equal(mentionsCode("La similitud coseno mide el ángulo entre dos vectores.", map), false);
});

test("assessEvidence: sin citas y hablando del proyecto → missing", () => {
  assert.equal(assessEvidence("El auth está en `src/auth/service.ts`.", "project", map), "missing");
  assert.equal(assessEvidence("El login valida el token antes de responder.", "project", map), "missing");
  // Sin `grounding` (modelo que ignora el esquema): nombrar archivos sin citar también cuenta como afirmar.
  assert.equal(assessEvidence("El auth está en `src/auth/service.ts`.", null, map), "missing");
  // Una cita inválida no rescata la respuesta.
  assert.equal(assessEvidence("El auth está en `src/auth.ts:3`.", "project", map), "missing");
});

test("assessEvidence: con una cita válida, teoría pura o admitiendo que no está → pasa", () => {
  assert.equal(assessEvidence("Arranca en `src/app.ts:10`.", "project", map), "cited");
  assert.equal(assessEvidence("La similitud coseno mide el ángulo entre vectores.", "theory", map), "theory");
  assert.equal(assessEvidence("La similitud coseno mide el ángulo entre vectores.", null, map), "theory");
  assert.equal(assessEvidence("El mapa no muestra ningún módulo de autenticación.", "not-in-map", map), "not-in-map");
});

/** Proveedor falso: devuelve las respuestas en orden y guarda lo que se le pidió. */
function fakeProvider(replies: unknown[]): AiProvider & { requests: CompleteJsonRequest[] } {
  const requests: CompleteJsonRequest[] = [];
  return {
    id: "openai",
    model: "fake",
    requests,
    completeJson: async (request) => {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) throw new Error("sin más respuestas");
      return next;
    },
    completeText: async () => {
      throw new Error("no se usa");
    },
  };
}

function ask(provider: AiProvider) {
  return answerFollowUp({
    question: "¿Dónde está el auth?",
    nodeName: "demo",
    filePath: null,
    history: [],
    map,
    provider,
    signal: new AbortController().signal,
  });
}

const uncited = { format: "text", answer: "El auth está en `src/auth/service.ts`.", lessonGoal: "", grounding: "project" };

test("answerFollowUp: respuesta sin citas → un reintento; si el reintento cita, se usa", async () => {
  const provider = fakeProvider([uncited, { format: "text", answer: "El arranque está en `src/app.ts:10-20`.", lessonGoal: "", grounding: "project" }]);
  const reply = await ask(provider);
  assert.equal(provider.requests.length, 2);
  assert.match(provider.requests[1]?.user ?? "", /rejected_answer/);
  assert.equal(reply.evidence, "cited");
  assert.equal(reply.answer, "El arranque está en `src/app.ts:10-20`.");
});

test("answerFollowUp: si el reintento tampoco cita, se devuelve la primera marcada como missing", async () => {
  const provider = fakeProvider([uncited, uncited]);
  const reply = await ask(provider);
  assert.equal(provider.requests.length, 2);
  assert.equal(reply.evidence, "missing");
  assert.equal(reply.answer, uncited.answer);
});

test("answerFollowUp: con cita válida pasa a la primera, sin reintento", async () => {
  const provider = fakeProvider([{ format: "text", answer: "Mira `src/app.ts:10`.", lessonGoal: "", grounding: "project" }]);
  const reply = await ask(provider);
  assert.equal(provider.requests.length, 1);
  assert.equal(reply.evidence, "cited");
});

test("answerFollowUp: un fallo del reintento no pierde la primera respuesta", async () => {
  const provider = fakeProvider([uncited]);
  const reply = await ask(provider);
  assert.equal(reply.evidence, "missing");
  assert.equal(reply.answer, uncited.answer);
});

test("answerFollowUp: los recorridos guiados no pasan por el filtro", async () => {
  const provider = fakeProvider([{ format: "lesson", answer: "Te lo enseño paso a paso.", lessonGoal: "¿Cómo arranca?", grounding: "project" }]);
  const reply = await ask(provider);
  assert.equal(provider.requests.length, 1);
  assert.equal(reply.evidence, null);
});
