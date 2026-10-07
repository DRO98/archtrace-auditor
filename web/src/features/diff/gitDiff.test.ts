import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraph } from "@core/graph";
import { parseIdeMessage, buildRequestGitDiff } from "@/lib/protocol";
import { diffCounts, diffGraph } from "./lib/gitDiff";

const graph: CodeGraph = {
  version: 1,
  projectName: "shop",
  groups: [],
  modules: ["src/api.ts", "src/service.ts", "src/old.ts", "src/a.ts"].map((filePath) => ({
    id: filePath,
    label: filePath,
    filePath,
    groupId: "g",
    language: "typescript",
    subBlocks: [],
  })),
  edges: [],
};

test("diffGraph: estados por nodo, renombrados y archivos fuera del lienzo", () => {
  const diff = diffGraph(graph, [
    { path: "apps/shop/src/api.ts", status: "modified" },
    { path: "src/new.ts", status: "added" },
    { path: "src/old.ts", status: "deleted" },
    { path: "src/gone.py", status: "deleted" },
    { path: "src/b.ts", status: "renamed", previousPath: "src/a.ts" },
    { path: "README.md", status: "modified" },
  ]);
  assert.deepEqual(diff.byNode, { "src/api.ts": "modified", "src/old.ts": "deleted", "src/a.ts": "deleted" });
  assert.deepEqual(diff.deletedOutside, ["src/gone.py"]);
  assert.deepEqual(diff.changedOutside, ["README.md", "src/b.ts", "src/new.ts"]);
  assert.deepEqual(diffCounts(diff), { added: 0, modified: 1, deleted: 3 });
});

test("protocolo web: GIT_DIFF valida rutas y refs; no se construyen peticiones con refs peligrosos", () => {
  const frame = (payload: unknown) => JSON.stringify({ protocol: "TEACHER_CANVAS_v1", action: "GIT_DIFF", payload });
  const message = parseIdeMessage(
    frame({
      requestId: "abc",
      base: "main",
      head: null,
      files: [
        { path: "src/a.ts", status: "modified" },
        { path: "../etc/passwd", status: "modified" },
        { path: "/abs.ts", status: "added" },
        { path: "src/b.ts", status: "exploded" },
      ],
    }),
  );
  assert.equal(message?.action, "GIT_DIFF");
  if (message?.action === "GIT_DIFF") assert.deepEqual(message.payload.files, [{ path: "src/a.ts", status: "modified" }]);
  assert.equal(parseIdeMessage(frame({ requestId: "abc", base: "--exec=x", head: null, files: [] })), null);
  assert.equal(buildRequestGitDiff("abc", "-p", null), null);
  assert.equal(buildRequestGitDiff("abc", "main", "feature/x")?.payload.head, "feature/x");
});
