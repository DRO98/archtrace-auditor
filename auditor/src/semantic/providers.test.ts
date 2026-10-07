import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createProvider } from "@llm/index";
import { createAnthropicProvider } from "@llm/providers/anthropic";
import { createGeminiProvider } from "@llm/providers/gemini";
import { createOpenAiCompatibleProvider } from "@llm/providers/openai";
import { runAudit } from "../pipeline";
import { createAuditFixture, VECTOR_OFF } from "../test/fixture";
import type { TestRepo } from "../test/gitRepo";

/**
 * Recorre el código REAL de cada proveedor (SDK de OpenAI, `json_object` de Groq/DeepSeek/Ollama, `fetch` de
 * Anthropic y SDK de Gemini) contra servidores falsos locales: lo que se probaría con una clave real, sin coste.
 */

const ASSESSMENT = {
  category: "authorization",
  criticality: "critical",
  confidence: 0.92,
  reason: "Añade una comprobación de permiso que cambia quién puede borrar jugadores.",
  evidence: [{ line: 11, text: 'if not request.user.has_perm("players.delete_player"):' }],
  rule_refs: ["CLAUDE.md#autorizacion"],
  needs_more_context: false,
};

interface Captured {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

type Reply = (captured: Captured) => { status: number; body: unknown; headers?: Record<string, string> };

/** Servidor OpenAI-compatible mínimo (`POST /v1/chat/completions`). */
async function fakeOpenAiServer(reply: Reply): Promise<{ server: Server; url: string; requests: Captured[] }> {
  const requests: Captured[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const captured: Captured = { path: request.url ?? "", headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") };
      requests.push(captured);
      const { status, body, headers } = reply(captured);
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/v1`, requests };
}

function chatCompletion(content: string) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "fake",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876 },
  };
}

function isViewsUnit(captured: Captured): boolean {
  const messages = captured.body.messages as Array<{ content: string }>;
  return messages.some((message) => message.content.includes("Archivo: players/views.py"));
}

describe("proveedores reales contra servidores falsos", () => {
  let repo: TestRepo;
  let home: string;

  before(async () => {
    ({ repo } = await createAuditFixture());
  });

  beforeEach(() => {
    // Caché limpia por test: cada test debe llamar de verdad al proveedor.
    home = mkdtempSync(path.join(os.tmpdir(), "archtrace-home-"));
  });

  after(() => repo.dispose());

  const audit = (provider: Parameters<typeof runAudit>[0]["provider"], extra: Partial<Parameters<typeof runAudit>[0]> = {}) =>
    runAudit({ repo: repo.root, mode: "commit", home, provider, write: false, llmRetryBaseMs: 5, vector: VECTOR_OFF, ...extra }).finally(() =>
      rmSync(home, { recursive: true, force: true }),
    );

  it("OpenAI (json_schema estricto): esquema válido para strict y respuesta usada", async () => {
    const fake = await fakeOpenAiServer((captured) => ({
      status: 200,
      body: chatCompletion(JSON.stringify(isViewsUnit(captured) ? ASSESSMENT : { ...ASSESSMENT, category: "payments", criticality: "medium", evidence: [{ line: 2, text: "amount = int(amount)" }], rule_refs: [] })),
    }));
    try {
      const provider = createOpenAiCompatibleProvider({ id: "openai", apiKey: "sk-test-123456789012345678901234", model: "gpt-4o-mini", baseURL: fake.url, strictSchema: true });
      const { run } = await audit(provider);
      const first = fake.requests[0]!;
      assert.equal(first.path, "/v1/chat/completions");
      assert.equal(first.headers.authorization, "Bearer sk-test-123456789012345678901234");
      const format = first.body.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.strict, true);
      assertStrictSchema(format.json_schema.schema);
      assert.equal(first.body.max_completion_tokens, 2000);

      const authz = run.findings.find((finding) => finding.file === "players/views.py")!;
      assert.equal(authz.criticality, "critical");
      assert.equal(authz.origin.criticality, "both");
      assert.equal(authz.semantic?.usage?.promptTokens, 812);
      assert.equal(authz.reason.startsWith("Añade una comprobación"), true);
      const payments = run.findings.find((finding) => finding.file === "payments/service.py")!;
      assert.equal(payments.criticality, "medium");
      assert.equal(payments.origin.criticality, "llm");
      assert.equal(run.metrics.tokensIn, 812 * run.metrics.llmCalls);
      assert.equal(run.warnings.length, 0, run.warnings.join(" | "));
    } finally {
      fake.server.close();
    }
  });

  it("Groq/DeepSeek/Ollama (json_object + esquema en el prompt), con JSON envuelto en markdown", async () => {
    const fake = await fakeOpenAiServer(() => ({ status: 200, body: chatCompletion(`\`\`\`json\n${JSON.stringify(ASSESSMENT)}\n\`\`\``) }));
    try {
      const provider = createProvider({ provider: "ollama", model: "qwen2.5-coder", baseUrl: fake.url })!;
      assert.ok(provider);
      const { run } = await audit(provider);
      const first = fake.requests[0]!;
      assert.deepEqual(first.body.response_format, { type: "json_object" });
      const system = (first.body.messages as Array<{ role: string; content: string }>)[0]!.content;
      assert.match(system, /JSON Schema \(change_assessment\)/);
      assert.equal(run.findings.find((finding) => finding.file === "players/views.py")!.semantic?.category, "authorization");
    } finally {
      fake.server.close();
    }
  });

  it("429 con retry-after: se reintenta y la auditoría termina con LLM", async () => {
    let calls = 0;
    const fake = await fakeOpenAiServer(() => {
      calls += 1;
      if (calls <= 3) return { status: 429, body: { error: { message: "Rate limit reached", type: "rate_limit" } }, headers: { "retry-after": "0" } };
      return { status: 200, body: chatCompletion(JSON.stringify(ASSESSMENT)) };
    });
    try {
      const provider = createOpenAiCompatibleProvider({ id: "groq", apiKey: "gsk_test", model: "llama", baseURL: fake.url, strictSchema: false });
      const { run } = await audit(provider, { llmConcurrency: 1 });
      assert.ok(calls > 3, `el servidor devolvió 429 tres veces (${calls} llamadas)`);
      assert.ok(run.findings.find((finding) => finding.file === "players/views.py")!.semantic, "la unidad acaba con valoración del LLM");
      assert.ok(!run.warnings.some((warning) => /desactivado/.test(warning)));
    } finally {
      fake.server.close();
    }
  });

  it("clave inválida (401): se detiene tras el primer fallo y cae a reglas con aviso claro", async () => {
    const fake = await fakeOpenAiServer(() => ({ status: 401, body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } } }));
    try {
      const provider = createOpenAiCompatibleProvider({ id: "openai", apiKey: "sk-bad-000000000000000000000000", model: "gpt-4o", baseURL: fake.url, strictSchema: true });
      const { run } = await audit(provider, { llmConcurrency: 1 });
      assert.equal(fake.requests.length, 1);
      assert.match(run.warnings.join(" "), /LLM desactivado.*clave de OpenAI no es válida/);
      const authz = run.findings.find((finding) => finding.file === "players/views.py")!;
      assert.equal(authz.criticality, "critical", "las reglas siguen decidiendo");
      assert.equal(authz.semantic, undefined);
    } finally {
      fake.server.close();
    }
  });

  it("modelo inexistente (404): no repite la llamada en cada unidad", async () => {
    const fake = await fakeOpenAiServer(() => ({ status: 404, body: { error: { message: "The model `gpt-9` does not exist", code: "model_not_found" } } }));
    try {
      const provider = createOpenAiCompatibleProvider({ id: "openai", apiKey: "sk-test-123456789012345678901234", model: "gpt-9", baseURL: fake.url, strictSchema: true });
      const { run } = await audit(provider, { llmConcurrency: 1 });
      assert.equal(fake.requests.length, 1);
      assert.match(run.warnings.join(" "), /gpt-9/);
    } finally {
      fake.server.close();
    }
  });

  it("proveedor saturado que no responde: un intento por unidad (sin reintentar timeouts) y no bloquea", async () => {
    // Como Gemini con "high demand": acepta la conexión y no contesta nunca.
    const hanging: IncomingMessage[] = [];
    const server = createServer((request) => {
      hanging.push(request);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const provider = createOpenAiCompatibleProvider({ id: "gemini", apiKey: "x", model: "lento", baseURL: `http://127.0.0.1:${port}/v1`, strictSchema: false });
      const started = Date.now();
      const { run } = await audit(provider, { llmConcurrency: 1, llmTimeoutMs: 300, maxEscalations: 2 });
      assert.ok(Date.now() - started < 10_000, "no se queda colgada");
      assert.equal(hanging.length, 2, "una llamada por unidad no trivial, sin reintentos ni escalados");
      assert.match(run.warnings.join(" "), /no respondió en 0\.3 s/);
      assert.equal(run.findings.find((finding) => finding.file === "players/views.py")!.criticality, "critical", "las reglas deciden");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("presupuesto total de la fase LLM agotado: el resto por reglas", async () => {
    const fake = await fakeOpenAiServer(() => ({ status: 200, body: chatCompletion(JSON.stringify(ASSESSMENT)) }));
    try {
      const provider = createOpenAiCompatibleProvider({ id: "openai", apiKey: "sk-test-123456789012345678901234", model: "gpt-4o", baseURL: fake.url, strictSchema: true });
      const { run } = await audit(provider, { llmBudgetMs: 0 });
      assert.equal(fake.requests.length, 0);
      assert.match(run.warnings.join(" "), /Tiempo máximo de análisis con LLM agotado/);
    } finally {
      fake.server.close();
    }
  });

  it("Ollama apagado (red): aviso y sin bloquear la auditoría", async () => {
    const provider = createProvider({ provider: "ollama", model: "llama3", baseUrl: "http://127.0.0.1:9/v1" })!;
    const { run } = await audit(provider, { llmConcurrency: 1 });
    assert.match(run.warnings.join(" "), /LLM desactivado/);
    assert.equal(run.findings.length, 4);
  });

  it("Anthropic (herramienta con input_schema forzada)", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = original;
    });
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ content: [{ type: "tool_use", name: "change_assessment", input: ASSESSMENT }], stop_reason: "tool_use", usage: { input_tokens: 900, output_tokens: 80 } }),
        { status: 200 },
      );
    }) as typeof fetch;
    const { run } = await audit(createAnthropicProvider("sk-ant-test", "claude-haiku-4-5"));
    const tool = (bodies[0]!.tools as Array<{ name: string; input_schema: Record<string, unknown> }>)[0]!;
    assert.equal(tool.name, "change_assessment");
    assert.deepEqual(bodies[0]!.tool_choice, { type: "tool", name: "change_assessment" });
    assert.equal(run.findings.find((finding) => finding.file === "players/views.py")!.semantic?.usage?.promptTokens, 900);
  });

  it("Gemini (responseJsonSchema)", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = original;
    });
    const urls: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input instanceof Request ? input.url : input));
      bodies.push(JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : "{}"))));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(ASSESSMENT) }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 50, totalTokenCount: 750 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const { run } = await audit(createGeminiProvider("AIza-test", "gemini-3.8-flash"));
    assert.match(urls[0]!, /gemini-3\.8-flash:generateContent/);
    const config = bodies[0]!.generationConfig as Record<string, unknown>;
    assert.equal(config.responseMimeType, "application/json");
    assert.ok(config.responseJsonSchema);
    assert.equal(run.findings.find((finding) => finding.file === "players/views.py")!.semantic?.usage?.promptTokens, 700);
  });
});

/** Reglas de `json_schema` estricto de OpenAI: todo objeto con `additionalProperties: false` y todas sus propiedades requeridas. */
function assertStrictSchema(schema: Record<string, unknown>): void {
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(properties).sort());
    for (const child of Object.values(properties)) assertStrictSchema(child);
  }
  if (schema.type === "array") assertStrictSchema(schema.items as Record<string, unknown>);
}
