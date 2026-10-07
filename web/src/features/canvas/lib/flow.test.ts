import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { graphToFlow } from "./flow";
import { parseCodeGraph } from "./graph";
import { layoutGraph } from "./layout";

test("graphToFlow separa sub-nodos y aristas de apoyo", () => {
  const raw: unknown = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "public/graphs/macro_rag_project.json"), "utf8"),
  );
  const parsed = parseCodeGraph(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("grafo inválido");

  const flow = graphToFlow(parsed.graph, layoutGraph(parsed.graph));
  const supports = parsed.graph.modules.filter((item) => item.supportOf);
  assert.equal(supports.length, 3);

  for (const item of parsed.graph.modules) {
    const node = flow.nodes.find((entry) => entry.id === item.id);
    assert.equal(node?.type, item.supportOf ? "support" : "module");
  }

  const supportEdges = flow.edges.filter((edge) => edge.id.startsWith("support:"));
  assert.equal(supportEdges.length, supports.length);
  for (const item of supports) {
    const edge = supportEdges.find((entry) => entry.target === item.id);
    assert.ok(edge);
    assert.equal(edge.source, item.supportOf);
    assert.equal(edge.sourceHandle, `support:${item.id}`);
    assert.equal(edge.targetHandle, "in");
    const style = edge.style;
    assert.equal(typeof style === "object" && style !== null && "strokeDasharray" in style, true);
  }

  for (const item of supports) {
    const duplicates = flow.edges.filter(
      (edge) => edge.source === item.supportOf && edge.target === item.id && !edge.id.startsWith("support:"),
    );
    assert.equal(duplicates.length, 0);
  }

  assert.equal(Number.isInteger(flow.hiddenEdges), true);
  assert.ok(flow.hiddenEdges >= 0);
});
