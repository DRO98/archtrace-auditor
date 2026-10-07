import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLocalModel, formatBytes, ollamaTagsUrl, parseOllamaTags } from "./localScan";

test("ollamaTagsUrl quita /v1 y solo acepta hosts locales", () => {
  assert.equal(ollamaTagsUrl("http://localhost:11434/v1"), "http://localhost:11434/api/tags");
  assert.equal(ollamaTagsUrl("http://192.168.1.20:11434/v1/"), "http://192.168.1.20:11434/api/tags");
  assert.equal(ollamaTagsUrl(""), "http://localhost:11434/api/tags");
  assert.equal(ollamaTagsUrl("https://api.example.com/v1"), null);
  assert.equal(ollamaTagsUrl("file:///etc/passwd"), null);
  assert.equal(ollamaTagsUrl("http://user:pw@localhost:11434"), null);
});

test("parseOllamaTags lee nombre, tamaño y detalles", () => {
  const models = parseOllamaTags({
    models: [
      { name: "qwen2.5-coder:7b", size: 4_683_087_332, details: { parameter_size: "7.6B", quantization_level: "Q4_K_M", family: "qwen2" } },
      { name: "llama3:8b", size: 4_661_224_676, details: { parameter_size: "8.0B", quantization_level: "Q4_0" } },
      { size: 1 },
    ],
  });
  assert.deepEqual(models.map((item) => item.id), ["llama3:8b", "qwen2.5-coder:7b"]);
  assert.equal(describeLocalModel(models[1]!), "7.6B · Q4_K_M · 4.4 GB");
  assert.deepEqual(parseOllamaTags({ nope: true }), []);
});

test("formatBytes", () => {
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
});
