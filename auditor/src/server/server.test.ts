import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AuditRun, Finding, FileVersionResponse } from "@core/audit";
import { createAuditFixture } from "../test/fixture";
import type { TestRepo } from "../test/gitRepo";
import { createAuditorServer, listen } from "./server";

describe("servidor HTTP del auditor", () => {
  let repo: TestRepo;
  let home: string;
  let server: Server;
  let base = "";

  before(async () => {
    ({ repo } = await createAuditFixture());
    home = mkdtempSync(path.join(os.tmpdir(), "archtrace-home-"));
    server = createAuditorServer({ home });
    const address = await listen(server, { port: 0 });
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    repo.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) });

  it("rechaza orígenes no permitidos y responde CORS a los permitidos", async () => {
    const denied = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(denied.status, 403);
    const preflight = await fetch(`${base}/repos`, { method: "OPTIONS", headers: { origin: "http://localhost:3000" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PATCH/);
  });

  it("rechaza Host no loopback (DNS rebinding) y escrituras sin JSON", async () => {
    const port = Number(new URL(base).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/health", headers: { host: "attacker.example:80" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
    const form = await fetch(`${base}/repos`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "path=/" });
    assert.equal(form.status, 415);
  });

  it("vincula el repo, audita, lista, devuelve archivos y persiste la revisión", async () => {
    const linked = await fetch(`${base}/repos`, json({ path: path.join(repo.root, "players") }));
    assert.equal(linked.status, 201);
    const { repo: registered, index } = (await linked.json()) as { repo: { id: string; root: string }; index: { blobsParsed: number } };
    assert.ok(index.blobsParsed > 0);
    assert.equal(path.resolve(registered.root), path.resolve(repo.root));

    const refs = (await (await fetch(`${base}/repos/${registered.id}/refs`)).json()) as { current: string; commits: unknown[] };
    assert.equal(refs.current, "main");
    assert.equal(refs.commits.length, 2);

    const badRef = await fetch(`${base}/repos/${registered.id}/audits`, json({ mode: "range", base: "--output=x", head: "HEAD" }));
    assert.equal(badRef.status, 400);

    const created = await fetch(`${base}/repos/${registered.id}/audits`, json({ mode: "commit", taskId: "T-1" }));
    assert.equal(created.status, 201);
    const run = (await created.json()) as AuditRun;
    assert.equal(run.findings[0]!.id, "AUTHZ-001");

    const list = (await (await fetch(`${base}/repos/${registered.id}/audits`)).json()) as { audits: Array<{ id: string }> };
    assert.equal(list.audits[0]!.id, run.id);

    const head = (await (
      await fetch(`${base}/repos/${registered.id}/files?audit=${run.id}&side=head&path=${encodeURIComponent("players/views.py")}`)
    ).json()) as FileVersionResponse;
    assert.match(head.content ?? "", /has_perm/);
    const baseVersion = (await (
      await fetch(`${base}/repos/${registered.id}/files?audit=${run.id}&side=base&path=${encodeURIComponent("players/views.py")}`)
    ).json()) as FileVersionResponse;
    assert.doesNotMatch(baseVersion.content ?? "", /has_perm/);
    const outside = await fetch(`${base}/repos/${registered.id}/files?audit=${run.id}&side=head&path=${encodeURIComponent("players/models.py")}`);
    assert.equal(outside.status, 403);

    const patched = await fetch(`${base}/repos/${registered.id}/audits/${run.id}/findings/AUTHZ-001`, {
      ...json({ status: "false_positive", note: "El permiso ya se comprobaba en el middleware." }),
      method: "PATCH",
    });
    assert.equal(patched.status, 200);
    assert.equal(((await patched.json()) as Finding).review.status, "false_positive");
    assert.match(readFileSync(path.join(repo.root, "Auditoria.md"), "utf8"), /🚫 falso positivo/);

    const invalid = await fetch(`${base}/repos/${registered.id}/audits/${run.id}/findings/AUTHZ-001`, { ...json({ status: "borrado" }), method: "PATCH" });
    assert.equal(invalid.status, 400);
  });

  it("modo env: /health dice qué proveedor usaría (nunca la clave) y sin claves responde 400 claro", async (t) => {
    const keys = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY"] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    t.after(() => {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
    for (const key of keys) delete process.env[key];
    const empty = (await (await fetch(`${base}/health`)).json()) as { envProvider: unknown };
    assert.equal(empty.envProvider, null);
    const { repos } = (await (await fetch(`${base}/repos`)).json()) as { repos: Array<{ id: string }> };
    const refused = await fetch(`${base}/repos/${repos[0]!.id}/audits`, json({ mode: "commit", ai: "env" }));
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /auditor\/\.env/);

    process.env.GROQ_API_KEY = "gsk_" + "x".repeat(40);
    const raw = await (await fetch(`${base}/health`)).text();
    assert.match(raw, /"provider":"groq"/);
    assert.doesNotMatch(raw, /gsk_x/);
  });

  it("no acepta un proveedor de IA inventado", async () => {
    const { repos } = (await (await fetch(`${base}/repos`)).json()) as { repos: Array<{ id: string }> };
    const response = await fetch(`${base}/repos/${repos[0]!.id}/audits`, json({ mode: "commit", ai: { provider: "skynet", apiKey: "x" } }));
    assert.equal(response.status, 400);
  });
});
