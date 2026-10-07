import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { buildShareUrl, decodeShareState, encodeShareState, sharedDataFromHash, shortHash } from "./shareState";

const graph: CodeGraph = {
  version: 1,
  projectName: "demo",
  groups: [{ id: "api", label: "api", color: "sky" }],
  modules: [{ id: "a.py", label: "A", filePath: "a.py", groupId: "api", language: "python", subBlocks: [] }],
  edges: [],
};

test("el estado compartido hace ida y vuelta por la URL", () => {
  const encoded = encodeShareState({ v: 1, graph, selectedModuleId: "a.py", presentation: true });
  assert.match(encoded, /^[A-Za-z0-9+\-$]+$/);
  assert.deepEqual(decodeShareState(encoded), { v: 1, graph, selectedModuleId: "a.py", presentation: true });
});

test("buildShareUrl usa el hash y quita la query", () => {
  const url = buildShareUrl({ origin: "https://x.dev", pathname: "/" }, { v: 1, graph, selectedModuleId: null, presentation: false });
  assert.ok(url.startsWith("https://x.dev/#data="));
  assert.ok(sharedDataFromHash(new URL(url).hash));
});

test("decodeShareState rechaza basura y shortHash es estable", () => {
  assert.equal(decodeShareState("nope"), null);
  assert.equal(decodeShareState(""), null);
  assert.equal(shortHash("abc"), shortHash("abc"));
  assert.notEqual(shortHash("abc"), shortHash("abd"));
});
