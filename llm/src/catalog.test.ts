import assert from "node:assert/strict";
import test from "node:test";
import { keyWarning } from "./catalog";

test("keyWarning avisa de claves de plantilla, con espacios o de otro proveedor", () => {
  assert.equal(keyWarning("groq", ""), null);
  assert.equal(keyWarning("groq", "gsk_abcdefghijklmnop"), null);
  assert.match(keyWarning("groq", "tu_api_key") ?? "", /incompleta o de ejemplo/);
  assert.match(keyWarning("openai", "sk-abc def ghijkl") ?? "", /espacios/);
  assert.match(keyWarning("anthropic", "sk-proj-abcdefghijk") ?? "", /sk-ant-/);
});
