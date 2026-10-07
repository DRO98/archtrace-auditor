import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { SourceChangeBatcher, toWorkspaceSourcePath, type SourceChangeBatch } from "./sourceChanges.js";

describe("toWorkspaceSourcePath", () => {
  const root = path.resolve("workspace-root");

  it("returns a POSIX path relative to the workspace", () => {
    assert.equal(toWorkspaceSourcePath(root, path.join(root, "src", "rag", "chunker.py")), "src/rag/chunker.py");
  });

  it("rejects files outside the workspace", () => {
    assert.equal(toWorkspaceSourcePath(root, path.resolve(root, "..", "other", "src", "a.py")), null);
  });

  it("skips generated folders", () => {
    assert.equal(toWorkspaceSourcePath(root, path.join(root, "node_modules", "pkg", "src", "a.js")), null);
    assert.equal(toWorkspaceSourcePath(root, path.join(root, "web", ".next", "src", "a.js")), null);
  });
});

describe("SourceChangeBatcher", () => {
  it("dedupes a burst into one sorted batch after the debounce", async () => {
    const batches: SourceChangeBatch[] = [];
    const batcher = new SourceChangeBatcher((batch) => batches.push(batch), 20, () => Date.UTC(2026, 8, 26));
    batcher.add("src/b.py");
    batcher.add("src/a.py");
    batcher.add("src/b.py");
    assert.equal(batches.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(batches, [{ changedPaths: ["src/a.py", "src/b.py"], changedAt: "2026-09-26T00:00:00.000Z" }]);
    batcher.dispose();
  });

  it("dispose drops pending changes", async () => {
    const batches: SourceChangeBatch[] = [];
    const batcher = new SourceChangeBatcher((batch) => batches.push(batch), 20);
    batcher.add("src/a.py");
    batcher.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(batches.length, 0);
  });
});
