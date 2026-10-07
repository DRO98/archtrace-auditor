import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inferRole } from "./architecture";
import { describeConnection, describeModule, describeSubBlock, isHumanText } from "./describe";
import { parseCodeGraph } from "./graph";
import { layoutGraphWithRoutes } from "./layout";

function sandbox() {
  const raw: unknown = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "public/graphs/macro_rag_project.json"), "utf8"),
  );
  const parsed = parseCodeGraph(raw);
  if (!parsed.ok) throw new Error("grafo inválido");
  return parsed.graph;
}

test("describeModule nunca devuelve nombres crudos y tiene 3-5 palabras", () => {
  for (const item of sandbox().modules) {
    const text = describeModule(item, item.role ?? inferRole(item));
    assert.equal(isHumanText(text), true, `${item.id} → ${text}`);
    const count = text.split(/\s+/).length;
    assert.ok(count >= 3 && count <= 5, `${item.id} → ${text}`);
  }
});

test("describeModule reconoce las categorías del sandbox", () => {
  const byId = new Map(sandbox().modules.map((item) => [item.id, item]));
  const text = (id: string) => {
    const item = byId.get(id);
    assert.ok(item);
    return describeModule(item, item.role ?? inferRole(item));
  };
  assert.equal(text("src/bootstrap/app.py"), "Inicialización del sistema");
  assert.equal(text("src/rag/chunker.py"), "Troceado de textos");
  assert.equal(text("src/api/routes.py"), "Entrada de peticiones HTTP");
});

test("describeSubBlock da una frase en español sin guiones bajos", () => {
  for (const item of sandbox().modules) {
    for (const block of item.subBlocks) {
      const text = describeSubBlock(block, item.subBlocks);
      assert.ok(text.length > 0);
      assert.equal(/_/.test(text), false, `${block.id} → ${text}`);
    }
  }
});

test("describeConnection explica la relación API → pipeline", () => {
  const text = describeConnection(
    { label: "API Routes", role: "api" },
    { label: "RAG Pipeline", role: "pipeline" },
    { kind: "imports" },
  );
  assert.match(text, /petición HTTP/);
  assert.match(text, /RAG Pipeline/);
});

test("las rutas de dagre avanzan de izquierda a derecha", () => {
  const graph = sandbox();
  const layout = layoutGraphWithRoutes(graph);
  assert.ok(layout.routes.size > 0);
  for (const [key, points] of layout.routes) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      assert.ok(previous && current && current.x > previous.x, key);
    }
  }
});
