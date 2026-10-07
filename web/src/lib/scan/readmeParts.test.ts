import assert from "node:assert/strict";
import test from "node:test";
import { humanizePart, isReadmePath, readmePartDescriptions, readmeSummary, shortPartLabel } from "./readmeParts";

test("humanizePart quita prefijos de parte y respeta siglas y tildes", () => {
  assert.equal(humanizePart("parte1_gestos"), "Gestos");
  assert.equal(humanizePart("parte2_plataforma"), "Plataforma");
  assert.equal(humanizePart("parte3_chatbot_rag"), "Chatbot RAG");
  assert.equal(humanizePart("parte4_frontend"), "Frontend");
  assert.equal(humanizePart("integracion"), "Integración");
  assert.equal(humanizePart("02-data-platform"), "Data platform");
  assert.equal(humanizePart("bff"), "BFF");
  assert.equal(humanizePart("webApp"), "Web app");
});

test("isReadmePath: solo la raíz y las carpetas de primer nivel", () => {
  assert.ok(isReadmePath("README.md"));
  assert.ok(isReadmePath("parte1_gestos/README.md"));
  assert.equal(isReadmePath("parte1_gestos/entrenamiento/README.md"), false);
  assert.equal(isReadmePath("docs/guia.md"), false);
});

test("readmePartDescriptions lee la tabla Parte | Qué es | Carpeta y descarta URLs", () => {
  const readme = [
    "| Parte | Qué es | Carpeta |",
    "|---|---|---|",
    "| 1 | Reconocimiento de gestos con MediaPipe | [`parte1_gestos/`](parte1_gestos/) |",
    "| 3 bis | Chatbot RAG: LangChain + Qdrant | [`parte3_chatbot_rag/`](parte3_chatbot_rag/) |",
    "",
    "| Servicio | URL |",
    "|---|---|",
    "| API de acceso | http://localhost:8002/docs |",
  ].join("\n");
  const found = readmePartDescriptions(readme, new Set(["parte1_gestos", "parte3_chatbot_rag", "8002"]));
  assert.deepEqual(Object.fromEntries(found), {
    parte1_gestos: "Reconocimiento de gestos con MediaPipe",
    parte3_chatbot_rag: "Chatbot RAG: LangChain + Qdrant",
  });
});

test("shortPartLabel corta en el primer separador y renuncia si queda largo", () => {
  assert.equal(shortPartLabel("Chatbot RAG: LangChain + Qdrant"), "Chatbot RAG");
  assert.equal(shortPartLabel("Chatbot con LLM local (Ollama)"), "Chatbot");
  assert.equal(shortPartLabel("Portal web corporativo: panel, explorador"), "Portal web corporativo");
  assert.equal(shortPartLabel("Integración gestos ↔ plataforma ↔ chatbot (última fase)"), null);
});

test("readmeSummary: primera frase de prosa, sin títulos, insignias ni código", () => {
  const readme = "# Parte 2\n\n![CI](x.svg)\n\n```bash\nmake todo\n```\n\nCaptura, procesado y acceso a los viajes. Segunda frase.\n";
  assert.equal(readmeSummary(readme), "Captura, procesado y acceso a los viajes.");
  assert.equal(readmeSummary("# Solo título\n"), null);
});
