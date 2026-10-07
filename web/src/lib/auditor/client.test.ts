import assert from "node:assert/strict";
import test from "node:test";
import { AuditorError, createAuditorClient } from "./client";

function recorder(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, client: createAuditorClient("http://127.0.0.1:8090", fetchImpl) };
}

test("createAudit envía JSON al repo y devuelve el AuditRun", async () => {
  const { calls, client } = recorder([{ status: 201, body: { id: "20261007-101500-abcdef" } }]);
  const run = await client.createAudit("repo1", { mode: "commit", ai: { provider: "ollama", model: "llama3" } });
  assert.equal(run.id, "20261007-101500-abcdef");
  assert.equal(calls[0]!.url, "http://127.0.0.1:8090/repos/repo1/audits");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal((calls[0]!.init?.headers as Record<string, string>)["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { mode: "commit", ai: { provider: "ollama", model: "llama3" } });
});

test("reviewFinding y fileVersion codifican ids y rutas", async () => {
  const { calls, client } = recorder([
    { status: 200, body: { id: "AUTHZ-001" } },
    { status: 200, body: { path: "a b.py", side: "head", content: "x" } },
  ]);
  await client.reviewFinding("r", "20261007-101500-abcdef", "AUTHZ-001", { status: "accepted", note: "ok" });
  assert.equal(calls[0]!.url, "http://127.0.0.1:8090/repos/r/audits/20261007-101500-abcdef/findings/AUTHZ-001");
  assert.equal(calls[0]!.init?.method, "PATCH");
  await client.fileVersion("r", "20261007-101500-abcdef", "head", "dir/a b.py");
  assert.equal(calls[1]!.url, "http://127.0.0.1:8090/repos/r/files?audit=20261007-101500-abcdef&side=head&path=dir%2Fa+b.py");
});

test("los errores del auditor llegan con su mensaje y estado", async () => {
  const { client } = recorder([{ status: 409, body: { error: "Ya hay una auditoría en curso para este repo." } }]);
  await assert.rejects(client.createAudit("r", { mode: "commit" }), (error: unknown) => {
    assert.ok(error instanceof AuditorError);
    assert.equal(error.status, 409);
    assert.match(error.message, /en curso/);
    return true;
  });
});

test("sin auditor arrancado: mensaje accionable", async () => {
  const client = createAuditorClient("http://127.0.0.1:1", (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);
  await assert.rejects(client.listRepos(), /npm run serve/);
  assert.equal(await client.health(), null);
});
