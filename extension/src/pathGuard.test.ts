import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveExistingInsideWorkspace, resolveHighlightColor, resolveInsideWorkspace } from "./pathGuard.js";

describe("resolveInsideWorkspace", () => {
  const root = path.resolve("workspace-root");

  it("accepts a valid relative path inside the root", () => {
    const result = resolveInsideWorkspace(root, "src/rag/vector_store.py");
    assert.equal(result, path.join(root, "src", "rag", "vector_store.py"));
  });

  it("rejects ../../etc/passwd", () => {
    assert.equal(resolveInsideWorkspace(root, "../../etc/passwd"), null);
  });

  it("accepts an absolute path inside the root", () => {
    const inside = path.join(root, "src", "a.py");
    assert.equal(resolveInsideWorkspace(root, inside), inside);
  });

  it("rejects an absolute path outside the root", () => {
    const outside = path.resolve(root, "..", "secret.txt");
    assert.equal(resolveInsideWorkspace(root, outside), null);
  });

  it("resolves src/../src/a.py inside the root", () => {
    const result = resolveInsideWorkspace(root, "src/../src/a.py");
    assert.equal(result, path.join(root, "src", "a.py"));
  });
});

describe("resolveExistingInsideWorkspace", () => {
  it("accepts an existing file inside the root", () => {
    const base = mkdtempSync(path.join(tmpdir(), "tc-guard-"));
    try {
      const root = path.join(base, "ws");
      mkdirSync(root);
      writeFileSync(path.join(root, "a.py"), "x = 1\n");
      const result = resolveExistingInsideWorkspace(root, "a.py");
      assert.equal(result, realpathSync.native(path.join(root, "a.py")));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a missing file", () => {
    const base = mkdtempSync(path.join(tmpdir(), "tc-guard-"));
    try {
      assert.equal(resolveExistingInsideWorkspace(base, "missing.py"), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a symlink/junction inside the root that points outside", () => {
    const base = mkdtempSync(path.join(tmpdir(), "tc-guard-"));
    try {
      const root = path.join(base, "ws");
      const outside = path.join(base, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(path.join(outside, "secret.txt"), "secret\n");
      symlinkSync(outside, path.join(root, "link"), "junction");
      assert.notEqual(resolveInsideWorkspace(root, "link/secret.txt"), null);
      assert.equal(resolveExistingInsideWorkspace(root, "link/secret.txt"), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("resolveHighlightColor", () => {
  const fallback = "rgba(59, 130, 246, 0.3)";

  it("accepts hex and numeric rgb/rgba colors", () => {
    assert.equal(resolveHighlightColor("#ff0"), "#ff0");
    assert.equal(resolveHighlightColor("#112233cc"), "#112233cc");
    assert.equal(resolveHighlightColor("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
    assert.equal(resolveHighlightColor("rgba(255,0,0,0.25)"), "rgba(255,0,0,0.25)");
  });

  it("rejects arbitrary content inside rgba()", () => {
    assert.equal(resolveHighlightColor("rgba(0;background:url(x))"), fallback);
    assert.equal(resolveHighlightColor("rgba(300,0,0,0.3)"), fallback);
    assert.equal(resolveHighlightColor("red"), fallback);
  });
});
