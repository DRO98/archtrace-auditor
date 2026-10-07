import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Finding } from "@core/audit";
import type { AiProvider, CompleteJsonRequest } from "@llm/types";
import { runAudit } from "./pipeline";
import { listAudits, readAudit, updateReview } from "./report/store";
import { createAuditFixture, VECTOR_OFF } from "./test/fixture";
import type { TestRepo } from "./test/gitRepo";

function byFile(findings: readonly Finding[], file: string): Finding[] {
  return findings.filter((finding) => finding.file === file);
}

describe("pipeline determinista (sin LLM) sobre el repo fixture", () => {
  let repo: TestRepo;
  let home: string;

  before(async () => {
    ({ repo } = await createAuditFixture());
    home = mkdtempSync(path.join(os.tmpdir(), "archtrace-home-"));
  });

  after(() => {
    repo.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  it("clasifica los cambios del agente y escribe Auditoria.md + JSON", async () => {
    const { run } = await runAudit({ repo: repo.root, mode: "commit", home, taskId: "TASK-42" });

    const views = byFile(run.findings, "players/views.py");
    assert.equal(views.length, 1);
    const authz = views[0]!;
    assert.equal(authz.category, "authorization");
    assert.equal(authz.criticality, "critical");
    assert.equal(authz.symbol, "PlayerView.delete");
    assert.equal(authz.id, "AUTHZ-001");
    assert.equal(authz.rules[0]?.sectionId, "CLAUDE.md#autorizacion");
    assert.equal(authz.rules[0]?.critical, true);
    assert.deepEqual(authz.relatedTests, ["tests/test_players.py"]);

    const payments = byFile(run.findings, "payments/service.py");
    assert.equal(payments.length, 1);
    assert.equal(payments[0]!.category, "payments");
    assert.ok(["medium", "low"].includes(payments[0]!.criticality), payments[0]!.criticality);

    const css = byFile(run.findings, "static/site.css");
    assert.equal(css.length, 1);
    assert.equal(css[0]!.criticality, "low");
    assert.equal(css[0]!.category, "ui_style");

    assert.equal(run.findings[0]!.id, "AUTHZ-001", "la cola empieza por lo crítico");
    assert.equal(run.metrics.llmCalls, 0);
    assert.equal(run.metrics.unitsWithoutLlm, run.findings.length);
    assert.equal(run.taskId, "TASK-42");

    const markdown = readFileSync(path.join(repo.root, "Auditoria.md"), "utf8");
    assert.match(markdown, /AUTHZ-001 · CRÍTICA · `players\/views\.py` · `PlayerView\.delete`/);
    assert.match(markdown, /\[CLAUDE\.md#autorizacion\]\(CLAUDE\.md#L3\)/);
    assert.ok(readAudit(repo.root, run.id));
    assert.equal(listAudits(repo.root)[0]?.id, run.id);
  });

  it("un segundo run sin cambios no reparsea nada y no audita sus propios artefactos", async () => {
    const { run } = await runAudit({ repo: repo.root, mode: "commit", home });
    assert.equal(run.metrics.index.blobsParsed, 0);
    assert.equal(run.metrics.index.docsParsed, 0);
    assert.ok(run.metrics.index.blobsReused > 0);
    // Auditoria.md y .archtrace/ están sin seguimiento: en modo worktree no deben aparecer.
    const worktree = await runAudit({ repo: repo.root, mode: "worktree", home, write: false });
    assert.equal(worktree.run.findings.length, 0);
  });

  it("persiste la revisión humana en el JSON y en Auditoria.md", async () => {
    const { run } = await runAudit({ repo: repo.root, mode: "commit", home });
    const updated = updateReview(repo.root, run.id, "AUTHZ-001", { status: "accepted", note: "Revisado con el equipo." });
    assert.equal(updated.review.status, "accepted");
    assert.equal(readAudit(repo.root, run.id)!.findings.find((finding) => finding.id === "AUTHZ-001")!.review.note, "Revisado con el equipo.");
    const markdown = readFileSync(path.join(repo.root, "Auditoria.md"), "utf8");
    assert.match(markdown, /✅ aceptado/);
    assert.match(markdown, /Nota de revisión:\*\* Revisado con el equipo\./);
  });
});

/** Proveedor falso: responde en función del archivo de la unidad y registra cada petición. */
function fakeProvider(
  answer: (request: CompleteJsonRequest, call: number) => unknown,
  model = "fake-model",
): AiProvider & { requests: CompleteJsonRequest[] } {
  const requests: CompleteJsonRequest[] = [];
  return {
    id: "openai",
    model,
    requests,
    async completeJson(request) {
      requests.push(request);
      return { value: answer(request, requests.length), usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } };
    },
    async completeText() {
      throw new Error("no se usa");
    },
  };
}

describe("capa semántica con proveedor falso", () => {
  let repo: TestRepo;
  let home: string;

  before(async () => {
    ({ repo } = await createAuditFixture());
    home = mkdtempSync(path.join(os.tmpdir(), "archtrace-home-"));
  });

  after(() => {
    repo.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  it("valida, escala con límite y nunca consulta lo trivial", async () => {
    const provider = fakeProvider((request) => {
      if (request.user.includes("Archivo: players/views.py")) {
        // Intenta bajar la criticidad e inventa evidencia y una regla.
        return {
          category: "authorization",
          criticality: "low",
          confidence: 0.9,
          reason: "Añade comprobación de permiso.",
          evidence: [
            { line: 11, text: 'if not request.user.has_perm("players.delete_player"):' },
            { line: 40, text: "User.objects.all().delete()" },
          ],
          rule_refs: ["CLAUDE.md#autorizacion", "SECURITY.md#no-existe"],
          needs_more_context: false,
        };
      }
      // Pagos: pide más contexto siempre, con categoría fuera de taxonomía.
      return {
        category: "dinero",
        criticality: "medium",
        confidence: 0.2,
        reason: "No está claro.",
        evidence: [],
        rule_refs: [],
        needs_more_context: true,
      };
    });

    const { run } = await runAudit({ repo: repo.root, mode: "commit", home, provider, maxEscalations: 2, write: false, vector: VECTOR_OFF });

    // Nada de CSS ni tests al LLM.
    assert.ok(provider.requests.every((request) => !request.user.includes("static/site.css") && !request.user.includes("tests/test_players.py")));
    assert.equal(provider.requests[0]!.schemaName, "change_assessment");

    const authz = run.findings.find((finding) => finding.file === "players/views.py")!;
    assert.equal(authz.criticality, "critical", "el LLM no puede bajar de un has_perm con regla crítica");
    assert.equal(authz.semantic?.dropped.evidence, 1);
    assert.equal(authz.semantic?.dropped.ruleRefs, 1);
    assert.deepEqual(authz.semantic?.ruleRefs, ["CLAUDE.md#autorizacion"]);
    assert.ok(authz.evidence.some((item) => item.source === "llm" && item.line === 11));
    assert.equal(authz.contextLevel, 0);

    const payments = run.findings.find((finding) => finding.file === "payments/service.py")!;
    assert.equal(payments.semantic?.category, "unknown");
    assert.equal(payments.semantic?.dropped.invalidCategory, true);
    assert.equal(payments.semantic?.contextLevel, 2, "escala L0 → L1 → L2 y se detiene");
    assert.equal(payments.criticality, "unknown");
    assert.equal(payments.humanReviewRequired, true);
    const paymentCalls = provider.requests.filter((request) => request.user.includes("Archivo: payments/service.py"));
    assert.equal(paymentCalls.length, 3);
    assert.match(paymentCalls[1]!.user, /## L1 · Símbolo envolvente charge/);
    assert.match(paymentCalls[2]!.user, /## L2 · Estructura del archivo/);

    assert.equal(run.metrics.llmCalls, provider.requests.length);
    assert.equal(run.metrics.tokensIn, 100 * provider.requests.length);
    assert.ok((run.metrics.contextTokensByLevel[2] ?? 0) > 0);
    assert.equal(run.llm?.model, "fake-model");
  });

  it("la caché evita repetir llamadas idénticas (la clave incluye el modelo)", async () => {
    const provider = fakeProvider(
      () => ({
        category: "business_logic",
        criticality: "medium",
        confidence: 0.8,
        reason: "x",
        evidence: [],
        rule_refs: [],
        needs_more_context: false,
      }),
      "otro-modelo",
    );
    await runAudit({ repo: repo.root, mode: "commit", home, provider, write: false, vector: VECTOR_OFF });
    const calls = provider.requests.length;
    assert.ok(calls > 0);
    const second = await runAudit({ repo: repo.root, mode: "commit", home, provider, write: false, vector: VECTOR_OFF });
    assert.equal(provider.requests.length, calls);
    assert.equal(second.run.metrics.llmCalls, 0);
    assert.equal(second.run.metrics.cacheHits, calls);
  });
});
