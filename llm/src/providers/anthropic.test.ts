import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropicProvider } from "./anthropic";

test("anthropic completeJson devuelve el objeto de la herramienta y el consumo de tokens", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 120, output_tokens: 30 },
      }),
      { status: 200 },
    )) as typeof fetch;

  const provider = createAnthropicProvider("sk-ant-test", "claude-test");
  const result = await provider.completeJson(
    { system: "s", user: "u", schema: { type: "object" }, schemaName: "answer", maxTokens: 100 },
    new AbortController().signal,
  );
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(result.usage, { promptTokens: 120, completionTokens: 30, totalTokens: 150 });
});
