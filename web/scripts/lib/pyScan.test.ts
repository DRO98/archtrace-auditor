import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolveImports, scanPythonSource, type PythonBlock } from "./pyScan";

function load(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), "../sandbox", relativePath), "utf8");
}

function ranges(blocks: readonly PythonBlock[]): Array<[string, PythonBlock["kind"], number, number]> {
  return blocks.map((block) => [block.name, block.kind, block.startLine, block.endLine]);
}

test("scanPythonSource lee vector_store.py con rangos exactos", () => {
  const blocks = scanPythonSource(load("src/rag/vector_store.py"));
  assert.deepEqual(ranges(blocks), [
    ["VectorRecord", "class", 14, 21],
    ["VectorStore", "class", 24, 77],
    ["VectorStore.__init__", "method", 27, 31],
    ["VectorStore.upsert", "method", 33, 36],
    ["VectorStore.add_many", "method", 38, 44],
    ["VectorStore.delete", "method", 46, 51],
    ["VectorStore.get", "method", 53, 54],
    ["VectorStore.search", "method", 56, 68],
    ["VectorStore.__len__", "method", 70, 71],
    ["VectorStore._require_width", "method", 73, 77],
    ["cosine_similarity", "function", 80, 95],
  ]);
  const search = blocks.find((block) => block.name === "VectorStore.search");
  assert.equal(search?.parentName, "VectorStore");
});

test("scanPythonSource lee database.py con rangos exactos", () => {
  const blocks = scanPythonSource(load("src/db/database.py"));
  assert.deepEqual(ranges(blocks), [
    ["Note", "class", 11, 16],
    ["Database", "class", 19, 65],
    ["Database.__init__", "method", 22, 24],
    ["Database.load", "method", 26, 32],
    ["Database.save", "method", 34, 38],
    ["Database.insert", "method", 40, 43],
    ["Database.update", "method", 45, 48],
    ["Database.delete", "method", 50, 53],
    ["Database.get", "method", 55, 56],
    ["Database.list_notes", "method", 58, 62],
    ["Database.__len__", "method", 64, 65],
  ]);
});

test("resolveImports acepta imports absolutos y relativos", () => {
  const known = new Set([
    "src/rag/pipeline.py",
    "src/rag/vector_store.py",
    "src/rag/chunker.py",
    "src/llm/service.py",
    "src/llm/prompts.py",
  ]);
  const source = [
    "from rag.pipeline import RagPipeline",
    "import llm.service as service",
    "from .vector_store import VectorStore",
    "from ..llm.prompts import build_prompt",
    "from typing import Sequence",
    "import json",
  ].join("\n");

  assert.deepEqual(resolveImports(source, "src/rag/chunker.py", known), [
    "src/llm/prompts.py",
    "src/llm/service.py",
    "src/rag/pipeline.py",
    "src/rag/vector_store.py",
  ]);
});

test("scanPythonSource es estable", () => {
  const source = load("src/rag/vector_store.py");
  assert.deepEqual(scanPythonSource(source), scanPythonSource(source));
});
