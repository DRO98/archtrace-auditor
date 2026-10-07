import assert from "node:assert/strict";
import test from "node:test";
import { API_BACKEND_DEMO } from "@/features/demos/catalog/apiBackend";
import { EVENT_DRIVEN_SHOP_DEMO } from "@/features/demos/catalog/eventDrivenShop";
import { RAG_DOCUMENTS_DEMO } from "@/features/demos/catalog/ragDocuments";
import { detectArchitectureKind } from "../lib/architectureKind";
import { MAX_NOTES_PER_NODE, addNote, notesMarkdown, removeNote, sanitizeNotes, type NodeNote } from "./notes";

const note = (id: string, text = "Usar outbox"): NodeNote => ({ id, kind: "decision", text, createdAt: "2026-09-27T10:00:00.000Z" });

test("notas: añadir, recortar, límite por nodo y borrar", () => {
  const first = addNote({}, "a.ts", note("n1", "  Usar outbox  "));
  assert.ok(first);
  assert.equal(first.note.text, "Usar outbox");
  assert.equal(addNote(first.notes, "a.ts", note("n2", "   ")), null);
  let full = first.notes;
  for (let index = 1; index < MAX_NOTES_PER_NODE; index += 1) full = addNote(full, "a.ts", note(`x${index}`))?.notes ?? full;
  assert.equal(addNote(full, "a.ts", note("over")), null);
  assert.deepEqual(removeNote(first.notes, "a.ts", "n1"), {});
});

test("sanitizeNotes descarta lo corrupto sin romper", () => {
  const clean = sanitizeNotes({
    "a.ts": [note("n1"), { id: "bad" }, { ...note("n2"), kind: "otro" }],
    "b.ts": "no es lista",
    "c.ts": [],
  });
  assert.deepEqual(Object.keys(clean), ["a.ts"]);
  assert.deepEqual(clean["a.ts"]?.map((item) => `${item.id}:${item.kind}`), ["n1:decision", "n2:note"]);
  assert.deepEqual(sanitizeNotes(null), {});
});

test("notesMarkdown agrupa por nodo con su etiqueta", () => {
  const markdown = notesMarkdown({ "a.ts": [note("n1")] }, () => "Orders API");
  assert.match(markdown, /## Notas de arquitectura\n\n### Orders API\n\n- \*\*Decisión\*\* \(2026-09-27\): Usar outbox/);
  assert.equal(notesMarkdown({}, () => ""), "");
});

test("detectArchitectureKind: Kafka → distribuido, FastAPI+Postgres → API, RAG → IA", () => {
  assert.equal(detectArchitectureKind(EVENT_DRIVEN_SHOP_DEMO.graph), "distributed");
  assert.equal(detectArchitectureKind(API_BACKEND_DEMO.graph), "api-backend");
  assert.equal(detectArchitectureKind(RAG_DOCUMENTS_DEMO.graph), "ai-pipeline");
  assert.equal(detectArchitectureKind({ modules: [], edges: [] }), "generic");
});
