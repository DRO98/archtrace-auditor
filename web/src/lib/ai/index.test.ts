import assert from "node:assert/strict";
import test from "node:test";
import { createProvider, readSelection } from "./index";

const ENV_KEYS = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_MODEL"];

function withEnv(values: Record<string, string>, run: () => void): void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("createProvider: la selección del navegador con clave usable gana al .env", () => {
  withEnv({ GEMINI_API_KEY: "gemini-env-key-123" }, () => {
    const provider = createProvider({ provider: "groq", model: "openai/gpt-oss-120b", apiKey: "gsk_browser_key_123" });
    assert.equal(provider?.id, "groq");
    assert.equal(provider?.model, "openai/gpt-oss-120b");
  });
});

test("createProvider: sin clave en el navegador usa la del .env del mismo proveedor, nunca otro", () => {
  withEnv({ GEMINI_API_KEY: "gemini-env-key-123", GROQ_API_KEY: "gsk_env_key_123" }, () => {
    const same = createProvider({ provider: "gemini", model: "gemini-1.5-pro" });
    assert.equal(same?.id, "gemini");
    assert.equal(same?.model, "gemini-1.5-pro");

    const groq = createProvider({ provider: "groq", model: "openai/gpt-oss-120b" });
    assert.equal(groq?.id, "groq");

    assert.equal(createProvider({ provider: "openai", model: "gpt-4o", apiKey: "tu_api_key" }), null);
  });
});

test("createProvider: sin selección decide el .env completo", () => {
  withEnv({ GEMINI_API_KEY: "gemini-env-key-123" }, () => {
    assert.equal(createProvider(null)?.id, "gemini");
  });
});

test("createProvider: Ollama no exige clave y sin nada configurado devuelve null", () => {
  withEnv({}, () => {
    assert.equal(createProvider({ provider: "ollama", model: "llama3" })?.id, "ollama");
    assert.equal(createProvider(null), null);
    assert.equal(createProvider({ provider: "anthropic" }), null);
  });
});

test("readSelection descarta proveedores desconocidos y modelos sospechosos", () => {
  assert.equal(readSelection({ provider: "evil" }), null);
  assert.equal(readSelection("gemini"), null);
  assert.deepEqual(readSelection({ provider: "openai", model: "gpt 4o; rm", apiKey: 3 }), {
    provider: "openai",
    model: undefined,
    apiKey: undefined,
  });
});

test("readSelection: un modelo retirado guardado en el navegador pasa al por defecto del proveedor", () => {
  const selection = readSelection({ provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk_browser_key_123" });
  assert.equal(selection?.model, "openai/gpt-oss-120b");
  assert.equal(readSelection({ provider: "groq", model: "qwen/qwen3.8-27b" })?.model, "qwen/qwen3.8-27b");
});
