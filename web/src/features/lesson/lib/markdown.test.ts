import assert from "node:assert/strict";
import test from "node:test";
import { checkCitation, parseInline, parseMarkdown } from "./markdown";

test("parseMarkdown separa párrafos, listas y bloques de código", () => {
  const blocks = parseMarkdown("Primero.\n\n- uno\n- dos\n\n1. a\n2. b\n\n```py\ndef f(x):\n```\nFin");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["p", "ul", "ol", "code", "p"],
  );
  const code = blocks[3];
  assert.equal(code?.type === "code" ? code.text : null, "def f(x):");
});

test("parseInline reconoce código, negrita y citas con o sin backticks", () => {
  const inlines = parseInline("Mira `src/rag/pipeline.py:42-60` y **esto**, o src/db/database.py:7 o `embed()`.");
  const cites = inlines.filter((item) => item.type === "cite");
  assert.equal(cites.length, 2);
  assert.deepEqual(cites[0], {
    type: "cite",
    raw: "src/rag/pipeline.py:42-60",
    path: "src/rag/pipeline.py",
    line: 42,
    endLine: 60,
  });
  assert.ok(inlines.some((item) => item.type === "strong" && item.text === "esto"));
  assert.ok(inlines.some((item) => item.type === "code" && item.text === "embed()"));
});

test("parseMarkdown separa las fórmulas ```math del código", () => {
  const blocks = parseMarkdown("```math\ncos(q, d) = (q · d) / (‖q‖ · ‖d‖)\n\n```\n```py\nx = 1\n```");
  assert.deepEqual(blocks[0], { type: "math", lines: ["cos(q, d) = (q · d) / (‖q‖ · ‖d‖)"] });
  assert.equal(blocks[1]?.type, "code");
});

test("parseMarkdown conserva la numeración cuando el modelo separa los puntos con líneas en blanco", () => {
  const blocks = parseMarkdown("1. uno\n\n2. dos\n3. tres");
  assert.deepEqual(
    blocks.map((block) => (block.type === "ol" ? [block.start, block.items.length] : block.type)),
    [[1, 1], [2, 2]],
  );
});

test("parseInline reconoce *cursiva* sin confundirla con multiplicaciones ni negrita", () => {
  assert.ok(parseInline("*Recuperación* (retrieval)").some((item) => item.type === "em" && item.text === "Recuperación"));
  assert.ok(parseInline("a * b * c").every((item) => item.type === "text"));
  assert.ok(parseInline("**clave**").every((item) => item.type === "strong"));
});

test("parseInline no confunde horas ni versiones con citas", () => {
  assert.ok(parseInline("a las 12.30:45 con v1.2:3").every((item) => item.type === "text"));
});

test("checkCitation contrasta ruta y líneas con el mapa", () => {
  const files = new Map([["src/a.py", 50]]);
  assert.equal(checkCitation({ path: "src/a.py", line: 10, endLine: 20 }, files), "ok");
  assert.equal(checkCitation({ path: "src/a.py", line: 10, endLine: 99 }, files), "line-out-of-range");
  assert.equal(checkCitation({ path: "src/inventado.py", line: 1, endLine: null }, files), "unknown-file");
  assert.equal(checkCitation({ path: "src/a.py", line: 1, endLine: null }, null), "unchecked");
});
