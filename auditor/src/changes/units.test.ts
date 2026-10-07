import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FilePatch } from "../git/patch";
import type { BlobEntry } from "../index/repoIndex";
import { buildUnits } from "./units";

function entry(symbols: BlobEntry["symbols"]): BlobEntry {
  return { language: "python", lineCount: 40, imports: [], symbols, calls: [], lastUsed: "" };
}

const head = entry([
  { name: "Svc", qualifiedName: "Svc", kind: "class", range: { startLine: 1, endLine: 20 }, signature: "class Svc" },
  { name: "a", qualifiedName: "Svc.a", parentQualifiedName: "Svc", kind: "method", range: { startLine: 2, endLine: 5 }, signature: "def a(self)" },
  { name: "b", qualifiedName: "Svc.b", parentQualifiedName: "Svc", kind: "method", range: { startLine: 7, endLine: 12 }, signature: "def b(self)" },
]);
const base = entry([
  { name: "Svc", qualifiedName: "Svc", kind: "class", range: { startLine: 1, endLine: 18 }, signature: "class Svc" },
  { name: "b", qualifiedName: "Svc.b", parentQualifiedName: "Svc", kind: "method", range: { startLine: 5, endLine: 10 }, signature: "def b(self)" },
]);

describe("buildUnits", () => {
  const patch: FilePatch = {
    path: "svc.py",
    status: "modified",
    binary: false,
    hunks: [
      {
        header: "@@ -1,0 +2,5 @@",
        oldStart: 1,
        oldLines: 0,
        newStart: 2,
        newLines: 5,
        lines: [
          { kind: "add", line: 2, text: "    def a(self):" },
          { kind: "add", line: 3, text: "        return 1" },
          { kind: "add", line: 4, text: "" },
          { kind: "add", line: 6, text: "" },
        ],
      },
      {
        header: "@@ -8 +10 @@",
        oldStart: 8,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        lines: [
          { kind: "del", line: 8, text: "        return old" },
          { kind: "add", line: 10, text: "        return new" },
        ],
      },
      {
        header: "@@ -17,0 +25 @@",
        oldStart: 17,
        oldLines: 0,
        newStart: 25,
        newLines: 1,
        lines: [{ kind: "add", line: 25, text: "X = 1" }],
      },
    ],
  };
  const units = buildUnits(patch, { base, head });

  it("agrupa por símbolo envolvente usando base para borrados y head para añadidos", () => {
    assert.deepEqual(
      units.map((unit) => [unit.symbol?.qualifiedName ?? null, unit.added, unit.removed, unit.headLines?.startLine ?? null]),
      [
        ["Svc.a", 4, 0, 2],
        ["Svc.b", 1, 1, 10],
        [null, 1, 0, 25],
      ],
    );
    assert.equal(units[1]!.symbol?.side, "head");
    assert.deepEqual(units[1]!.baseLines, { startLine: 8, endLine: 8 });
  });

  it("ids estables aunque el hunk se desplace", () => {
    const shifted: FilePatch = {
      ...patch,
      hunks: patch.hunks.map((hunk) => ({ ...hunk, lines: hunk.lines.map((line) => ({ ...line, line: line.line + 100 })) })),
    };
    const moved = buildUnits(shifted, { base: null, head: null });
    const plain = buildUnits(patch, { base: null, head: null });
    assert.deepEqual(moved.map((unit) => unit.id), plain.map((unit) => unit.id));
  });

  it("archivo binario: una unidad sin líneas", () => {
    const binary = buildUnits({ path: "logo.png", status: "modified", binary: true, hunks: [] }, { base: null, head: null });
    assert.equal(binary.length, 1);
    assert.equal(binary[0]!.lines.length, 0);
  });
});
