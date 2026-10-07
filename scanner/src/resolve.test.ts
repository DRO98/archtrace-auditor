import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectMap } from "./resolve.js";
import type { RawFile } from "./types.js";

function file(filePath: string, partial: Partial<RawFile> & Pick<RawFile, "symbols" | "callSites" | "imports">): { filePath: string; raw: RawFile } {
  return {
    filePath,
    raw: {
      language: "python",
      lineCount: 10,
      ...partial,
      imports: partial.imports,
      symbols: partial.symbols,
      callSites: partial.callSites,
    },
  };
}

const meta = {
  workspaceName: "demo",
  generatedAt: "2026-01-01T00:00:00.000Z",
  truncated: false,
  skippedFiles: 0,
};

describe("buildProjectMap", () => {
  it("resolves self inside the class only", () => {
    const map = buildProjectMap([
      file("src/box.py", {
        imports: [],
        symbols: [
          { kind: "class", name: "Box", qualifiedName: "Box", range: { startLine: 1, endLine: 8 }, signature: "class Box" },
          { kind: "method", name: "open", qualifiedName: "Box.open", parentQualifiedName: "Box", range: { startLine: 2, endLine: 4 }, signature: "def open" },
          { kind: "method", name: "use", qualifiedName: "Box.use", parentQualifiedName: "Box", range: { startLine: 5, endLine: 8 }, signature: "def use" },
        ],
        callSites: [{ name: "open", receiver: "self", isNew: false, range: { startLine: 7, endLine: 7 }, enclosing: "Box.use" }],
      }),
    ], meta);
    assert.equal(map.files[0]?.symbols[2]?.calls[0]?.target, "src/box.py::Box.open");
  });

  it("does not resolve a non-self receiver in the same file", () => {
    const map = buildProjectMap([
      file("src/box.py", {
        imports: [],
        symbols: [
          { kind: "class", name: "Box", qualifiedName: "Box", range: { startLine: 1, endLine: 6 }, signature: "class Box" },
          { kind: "method", name: "get", qualifiedName: "Box.get", parentQualifiedName: "Box", range: { startLine: 2, endLine: 6 }, signature: "def get" },
        ],
        callSites: [{ name: "get", receiver: "self._records", isNew: false, range: { startLine: 4, endLine: 4 }, enclosing: "Box.get" }],
      }),
    ], meta);
    assert.equal(map.files[0]?.symbols[1]?.calls.length, 0);
    assert.equal(map.stats.unresolvedCalls, 1);
  });

  it("drops ambiguous calls", () => {
    const map = buildProjectMap([
      file("src/a.py", {
        imports: [],
        symbols: [
          { kind: "function", name: "run", qualifiedName: "run", range: { startLine: 1, endLine: 2 }, signature: "def run" },
          { kind: "function", name: "run", qualifiedName: "run_alias", range: { startLine: 4, endLine: 5 }, signature: "def run" },
          { kind: "function", name: "main", qualifiedName: "main", range: { startLine: 7, endLine: 8 }, signature: "def main" },
        ],
        callSites: [{ name: "run", receiver: null, isNew: false, range: { startLine: 8, endLine: 8 }, enclosing: "main" }],
      }),
    ], meta);
    assert.equal(map.files[0]?.symbols[2]?.calls.length, 0);
    assert.equal(map.stats.ambiguousCalls, 1);
  });

  it("resolves relative and suffix imports, and drops ties", () => {
    const map = buildProjectMap([
      file("src/rag/pipeline.py", {
        imports: [
          { specifier: "vector_store", level: 1 },
          { specifier: "llm.service", level: 0 },
          { specifier: "shared", level: 0 },
        ],
        symbols: [],
        callSites: [],
      }),
      file("src/rag/vector_store.py", { imports: [], symbols: [], callSites: [] }),
      file("src/llm/service.py", { imports: [], symbols: [], callSites: [] }),
      file("src/left/shared.py", { imports: [], symbols: [], callSites: [] }),
      file("src/right/shared.py", { imports: [], symbols: [], callSites: [] }),
    ], meta);
    assert.deepEqual(map.files.find((item) => item.filePath === "src/rag/pipeline.py")?.imports, [
      "src/llm/service.py",
      "src/rag/vector_store.py",
    ]);
  });

  it("changes revision when a range changes and ignores generatedAt", () => {
    const input = [
      file("src/a.py", {
        imports: [],
        symbols: [{ kind: "function", name: "a", qualifiedName: "a", range: { startLine: 1, endLine: 2 }, signature: "def a" }],
        callSites: [],
      }),
    ];
    const first = buildProjectMap(input, meta);
    const second = buildProjectMap(input, { ...meta, generatedAt: "2026-02-02T00:00:00.000Z" });
    assert.equal(first.revision, second.revision);
    const moved = buildProjectMap([
      file("src/a.py", {
        imports: [],
        symbols: [{ kind: "function", name: "a", qualifiedName: "a", range: { startLine: 2, endLine: 3 }, signature: "def a" }],
        callSites: [],
      }),
    ], meta);
    assert.notEqual(first.revision, moved.revision);
    assert.equal(first.revision.length, 12);
  });
});
