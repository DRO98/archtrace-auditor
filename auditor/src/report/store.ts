import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  compareFindings,
  emptySummary,
  REVIEW_STATUSES,
  type AuditListItem,
  type AuditRun,
  type Criticality,
  type Finding,
  type ReviewStatus,
} from "@core/audit";
import type { Decision } from "../decision/decide";
import { categoryPrefix, type Taxonomy } from "../rules/taxonomy";
import { AUDIT_ID_MARKER, renderAuditMarkdown } from "./markdown";

export const AUDIT_MARKDOWN = "Auditoria.md";
const AUDITS_DIR = path.join(".archtrace", "audits");
const AUDIT_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export function isAuditId(value: string): boolean {
  return AUDIT_ID.test(value);
}

export function newAuditId(now = new Date()): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${randomBytes(3).toString("hex")}`;
}

/** Orden de la cola (criticidad, confianza) y ids correlativos por categoría: `AUTHZ-001`, `AUTHZ-002`… */
export function assignIds(decisions: readonly Decision[], taxonomy: Taxonomy): Finding[] {
  const provisional = decisions.map((decision) => ({ ...decision, id: "" }) as Finding).sort(compareFindings);
  const counters = new Map<string, number>();
  return provisional.map((finding) => {
    const prefix = categoryPrefix(taxonomy, finding.category);
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return { ...finding, id: `${prefix}-${String(next).padStart(3, "0")}` };
  });
}

export function summarize(findings: readonly Finding[]): Record<Criticality, number> {
  const summary = emptySummary();
  for (const finding of findings) summary[finding.criticality] += 1;
  return summary;
}

function auditFile(repoRoot: string, id: string): string {
  if (!isAuditId(id)) throw new Error(`Id de auditoría no válido: ${id}`);
  return path.join(repoRoot, AUDITS_DIR, `${id}.json`);
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, file);
}

/** Guarda el JSON sidecar y regenera `Auditoria.md` (la auditoría recién escrita pasa a ser la vigente). */
export function writeAudit(repoRoot: string, run: AuditRun): void {
  writeAtomic(auditFile(repoRoot, run.id), `${JSON.stringify(run, null, 2)}\n`);
  writeAtomic(path.join(repoRoot, AUDIT_MARKDOWN), renderAuditMarkdown(run));
}

export function readAudit(repoRoot: string, id: string): AuditRun | null {
  const file = auditFile(repoRoot, id);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as AuditRun;
}

export function listAudits(repoRoot: string): AuditListItem[] {
  const directory = path.join(repoRoot, AUDITS_DIR);
  if (!existsSync(directory)) return [];
  const items: AuditListItem[] = [];
  for (const name of readdirSync(directory)) {
    const id = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !isAuditId(id)) continue;
    try {
      const run = readAudit(repoRoot, id);
      if (!run) continue;
      items.push({
        id: run.id,
        createdAt: run.createdAt,
        mode: run.mode,
        base: run.base,
        head: run.head,
        headSha: run.headSha,
        ...(run.taskId ? { taskId: run.taskId } : {}),
        summary: run.summary,
        reviewed: run.findings.filter((finding) => finding.review.status !== "pending").length,
        total: run.findings.length,
      });
    } catch {
      // JSON dañado: se omite del historial.
    }
  }
  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** Id de la auditoría que muestra ahora `Auditoria.md` (marcador en la primera línea). */
export function currentMarkdownAuditId(repoRoot: string): string | null {
  const file = path.join(repoRoot, AUDIT_MARKDOWN);
  if (!existsSync(file)) return null;
  const match = new RegExp(`<!-- ${AUDIT_ID_MARKER}: (\\S+) -->`).exec(readFileSync(file, "utf8").slice(0, 300));
  return match?.[1] ?? null;
}

export interface ReviewUpdate {
  status: ReviewStatus;
  note?: string;
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value);
}

/**
 * Persiste la revisión humana de un hallazgo en el JSON y, si esa auditoría es la vigente en `Auditoria.md`
 * (o no hay ninguna), regenera el Markdown al momento.
 */
export function updateReview(repoRoot: string, auditId: string, findingId: string, update: ReviewUpdate, now = new Date()): Finding {
  const run = readAudit(repoRoot, auditId);
  if (!run) throw new Error(`No existe la auditoría ${auditId}.`);
  const finding = run.findings.find((item) => item.id === findingId);
  if (!finding) throw new Error(`No existe el hallazgo ${findingId}.`);
  finding.review = {
    status: update.status,
    ...(update.note?.trim() ? { note: update.note.trim().slice(0, 2000) } : {}),
    updatedAt: now.toISOString(),
  };
  writeAtomic(auditFile(repoRoot, auditId), `${JSON.stringify(run, null, 2)}\n`);
  const current = currentMarkdownAuditId(repoRoot);
  if (current === null || current === auditId) writeAtomic(path.join(repoRoot, AUDIT_MARKDOWN), renderAuditMarkdown(run));
  return finding;
}
