import assert from "node:assert/strict";
import test from "node:test";
import { chunkCount, chunkText } from "./chunker";
import { Embedder, normalize } from "./embedder";
import { RagPipeline, buildAnswerPrompt } from "./pipeline";
import { VectorStore, cosineSimilarity } from "./vectorStore";

test("chunkText colapsa espacios y devuelve una sola ventana si cabe", () => {
  assert.deepEqual(chunkText("  hola \n\n  mundo  "), ["hola mundo"]);
  assert.deepEqual(chunkText("   \n\t "), []);
});

test("chunkText solapa ventanas y la última puede ser más corta (igual que el sandbox Python)", () => {
  const text = "abcdefghij".repeat(3); // 30 caracteres
  const chunks = chunkText(text, 12, 4);
  assert.deepEqual(chunks, ["abcdefghijab", "ijabcdefghij", "ghijabcdefgh", "efghij"]);
  assert.equal(chunkCount(text, 12, 4), 4);
  // El final de cada ventana reaparece al principio de la siguiente.
  assert.equal(chunks[0]?.slice(-4), chunks[1]?.slice(0, 4));
});

test("chunkText valida tamaño y solapamiento", () => {
  assert.throws(() => chunkText("x", 0, 0), /size must be positive/);
  assert.throws(() => chunkText("x", 10, 10), /overlap must be smaller/);
});

test("normalize y Embedder son deterministas y normalizados", () => {
  assert.equal(normalize("¡Hola,"), "hola");
  const embedder = new Embedder(16);
  const a = embedder.embed("Vector store vector");
  assert.deepEqual(a, embedder.embed("vector STORE, vector!"));
  assert.equal(a.length, 16);
  assert.ok(Math.abs(a.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  assert.deepEqual(embedder.embed("¡¿?!"), new Array(16).fill(0));
});

test("cosineSimilarity: iguales = 1, ortogonales = 0, nulo = 0", () => {
  assert.equal(cosineSimilarity([1, 2, 0], [2, 4, 0]).toFixed(6), "1.000000");
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 2]), /share a dimension/);
});

test("VectorStore ordena por similitud, respeta el límite y valida el ancho", () => {
  const store = new VectorStore(2);
  store.addMany([
    { recordId: "a", text: "a", values: [1, 0], source: "s" },
    { recordId: "b", text: "b", values: [0.7, 0.7], source: "s" },
    { recordId: "c", text: "c", values: [0, 1], source: "s" },
  ]);
  assert.deepEqual(store.search([1, 0.1], 2).map((hit) => hit.record.recordId), ["a", "b"]);
  assert.deepEqual(store.search([1, 0], 0), []);
  assert.throws(() => store.upsert({ recordId: "x", text: "", values: [1], source: "s" }), /expected 2 dimensions/);
  assert.equal(store.delete("a"), true);
  assert.equal(store.delete("a"), false);
  assert.equal(store.size, 2);
});

test("RagPipeline recupera el fragmento más parecido a la pregunta", () => {
  const pipeline = new RagPipeline();
  const text = [
    "Los gatos duermen muchas horas al día y cazan ratones por la noche.".repeat(4),
    "El vector store guarda embeddings y busca por similitud coseno entre vectores.".repeat(4),
  ].join(" ");
  assert.ok(pipeline.ingest("doc", text) > 1);
  const [best] = pipeline.retrieve("¿qué guarda el vector store?", 1);
  assert.ok(best?.text.includes("vector"));
  assert.match(best?.id ?? "", /^doc:\d+$/);
});

test("buildAnswerPrompt numera los fragmentos", () => {
  const prompt = buildAnswerPrompt("¿Qué?", [{ id: "d:0", text: "uno", score: 1 }, { id: "d:1", text: "dos", score: 0.5 }]);
  assert.equal(prompt, "Question: ¿Qué?\nContext:\n[1] uno\n[2] dos");
});
