import assert from "node:assert/strict";
import test from "node:test";
import { formatPayload, summarizePayload } from "./payload";

test("summarizePayload: cadenas y objetos", () => {
  assert.equal(summarizePayload("¿Qué hace   ArchTrace?"), '"¿Qué hace ArchTrace?"');
  assert.equal(summarizePayload({ document_id: "x", text: "y" }), "{document_id, text}");
  assert.equal(summarizePayload({ a: 1, b: 2, c: 3, d: 4, e: 5 }), "{a, b, c, +2}");
  assert.equal(summarizePayload({}), "{}");
  assert.ok(summarizePayload("x".repeat(200)).length <= 36);
});

test("formatPayload: JSON con sangría y cadenas largas recortadas", () => {
  const text = formatPayload({ a: 1, b: "x".repeat(500) });
  assert.match(text, /"a": 1/);
  assert.ok(text.includes("…"));
  assert.ok(text.length < 400);
});

test("formatPayload: arrays y profundidad acotados", () => {
  const list = formatPayload({ items: Array.from({ length: 30 }, (_, index) => index) });
  assert.match(list, /… \+22 más/);
  const deep = formatPayload({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  assert.ok(deep.includes('"…"'));
});

test("formatPayload: nunca lanza (ciclos, bigint, undefined)", () => {
  const cyclic: Record<string, unknown> = { name: "x" };
  cyclic.self = cyclic;
  assert.match(formatPayload(cyclic), /\[circular\]/);
  assert.match(formatPayload({ big: BigInt(10), nothing: undefined }), /"big": "10"/);
});

test("formatPayload: acota el total y trata las cadenas como texto", () => {
  assert.ok(formatPayload("a".repeat(5000)).length <= 1600);
  assert.equal(formatPayload("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
  assert.ok(formatPayload({ big: Array.from({ length: 8 }, () => "y".repeat(160)) }, { maxChars: 300 }).length <= 300);
});
