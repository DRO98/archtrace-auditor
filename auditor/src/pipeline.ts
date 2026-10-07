import path from "node:path";
import {
  AUDIT_SCHEMA_VERSION,
  CRITICALITY_RANK,
  type AuditMode,
  type AuditRun,
  type ChangeUnit,
  type DiffSide,
  type Finding,
  type SemanticAssessment,
  type Signal,
} from "@core/audit";
import { isSensitivePath } from "@core/sensitivePaths";
import type { AiProvider } from "@llm/types";
import { buildUnits, type FileVersions } from "./changes/units";
import type { ContextInput } from "./context/builder";
import { categoryFloors, decide, type Decision } from "./decision/decide";
import { collectChanges, readVersion } from "./git/changes";
import type { FilePatch } from "./git/patch";
import { runGit, type GitRunner } from "./git/run";
import { RepoIndex } from "./index/repoIndex";
import { MetricsRecorder } from "./metrics/metrics";
import { assignIds, newAuditId, summarize, writeAudit } from "./report/store";
import type { VectorConfig } from "./retrieval/vector";
import { setupRetrieval } from "./retrieval/vectorIndex";
import { detectSignals, isTrivial } from "./rules/detect";
import { loadTaxonomy, type Taxonomy } from "./rules/taxonomy";
import { LlmCache } from "./semantic/cache";
import { SemanticEngine } from "./semantic/engine";

export interface AuditOptions {
  /** Cualquier carpeta dentro del repo. */
  repo: string;
  mode: AuditMode;
  base?: string;
  head?: string;
  taskId?: string;
  planPath?: string;
  /** Proveedor BYOK ya construido (CLI: env/Ollama; servidor: clave de la petición, nunca persistida). */
  provider?: AiProvider | null;
  maxEscalations?: number;
  /** Unidades como máximo que se envían al LLM (las de más riesgo primero); el resto se decide por reglas. */
  maxLlmUnits?: number;
  /** Llamadas simultáneas al proveedor. */
  llmConcurrency?: number;
  /** Espera base entre reintentos ante 429/5xx (tests). */
  llmRetryBaseMs?: number;
  /** Plazo por llamada al LLM. */
  llmTimeoutMs?: number;
  /** Tiempo total máximo de la fase LLM. */
  llmBudgetMs?: number;
  /** RAG vectorial (Qdrant + Ollama). Por defecto, de las variables `ARCHTRACE_*`. */
  vector?: VectorConfig;
  /** Raíz de datos del auditor (índice, caché). Por defecto `~/.archtrace`. */
  home?: string;
  /** false = no escribir `Auditoria.md` ni el JSON (dry run). */
  write?: boolean;
  git?: GitRunner;
  now?: Date;
}

export interface AuditResult {
  run: AuditRun;
  taxonomy: Taxonomy;
}

const SEMANTIC_CONCURRENCY = 2;
const MAX_LLM_UNITS = 60;

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  const git = options.git ?? runGit;
  const metrics = new MetricsRecorder();
  const warnings: string[] = [];
  const now = options.now ?? new Date();

  const changes = await metrics.time("git", () => collectChanges(options.repo, { mode: options.mode, base: options.base, head: options.head }, git));
  warnings.push(...changes.warnings);
  const repoRoot = changes.repoRoot;
  const taxonomy = loadTaxonomy(repoRoot, warnings);

  const index = RepoIndex.load(repoRoot, { home: options.home });
  try {
    await metrics.time("index", () => index.refresh(git));
    const sections = index.docSections();
    const sectionsById = new Map(sections.map((section) => [section.id, section]));

    // Unidades por símbolo (base y head de cada archivo se resuelven por blob SHA en el índice).
    const prepared = await metrics.time("units", async () => {
      const out: Array<{ unit: ChangeUnit; versions: FileVersions; patch: FilePatch }> = [];
      for (const patch of changes.patches) {
        const versions = await fileVersions(index, repoRoot, changes.baseSha, changes.headSha, patch, git);
        for (const unit of buildUnits(patch, versions)) out.push({ unit, versions, patch });
      }
      return out;
    });

    const withSignals = await metrics.time("rules", async () => prepared.map((item) => ({ ...item, signals: detectSignals(item.unit, taxonomy) })));

    // Recuperación de reglas: BM25 siempre; híbrida con vectores si Qdrant + Ollama responden. Solo hace falta
    // cuando se consulta al LLM (sin LLM, las reglas se emparejan por categoría).
    const retrieval = options.provider
      ? await metrics.time("rag", () => setupRetrieval({ repoRoot, sections, index, warnings, ...(options.vector ? { config: options.vector } : {}) }))
      : null;
    if (retrieval) metrics.data.retrieval = { mode: retrieval.mode, embedded: retrieval.embedded, reused: retrieval.reused };

    // Capa semántica: solo para lo no trivial y nunca para archivos sensibles.
    const engine = options.provider
      ? new SemanticEngine({
          provider: options.provider,
          taxonomy,
          cache: LlmCache.inDir(index.dataDir),
          metrics,
          sectionIds: new Set(sectionsById.keys()),
          maxEscalations: options.maxEscalations,
          ...(options.llmRetryBaseMs !== undefined ? { retryBaseMs: options.llmRetryBaseMs } : {}),
          ...(options.llmTimeoutMs !== undefined ? { timeoutMs: options.llmTimeoutMs } : {}),
          ...(options.llmBudgetMs !== undefined ? { budgetMs: options.llmBudgetMs } : {}),
        })
      : null;
    const assessments = new Map<string, SemanticAssessment | null>();
    const skipped = new Map<string, string>();
    const textCache = new Map<string, Promise<string | null>>();
    const readText = (patch: FilePatch, side: DiffSide) => {
      const key = `${side}:${patch.path}`;
      let pending = textCache.get(key);
      if (!pending) {
        pending =
          side === "head"
            ? readVersion(repoRoot, changes.headSha, patch.path, patch.newBlob, git)
            : readVersion(repoRoot, changes.baseSha, patch.previousPath ?? patch.path, patch.oldBlob, git);
        textCache.set(key, pending);
      }
      return pending;
    };

    await metrics.time("semantic", async () => {
      const queue = withSignals.filter((item) => {
        if (isTrivial(item.signals, taxonomy)) return false;
        if (isSensitivePath(item.unit.file) || (item.unit.previousPath && isSensitivePath(item.unit.previousPath))) {
          skipped.set(item.unit.id, "Archivo sensible: su contenido no se envía al LLM.");
          return false;
        }
        if (item.unit.lines.length === 0) return false;
        return engine !== null;
      });
      // Tope de coste: primero lo que tiene señales fuertes, luego débiles, luego el resto; a igualdad, más líneas.
      const limit = options.maxLlmUnits ?? MAX_LLM_UNITS;
      if (queue.length > limit) {
        const score = (item: (typeof queue)[number]) =>
          (item.signals.some((signal) => signal.strength === "strong") ? 2 : item.signals.length > 0 ? 1 : 0) * 1e6 + item.unit.lines.length;
        queue.sort((left, right) => score(right) - score(left));
        for (const item of queue.splice(limit)) skipped.set(item.unit.id, `Fuera del tope de ${limit} unidades analizadas con LLM.`);
        warnings.push(`Diff grande: ${limit} unidades analizadas con LLM (las de más riesgo); el resto, solo con reglas.`);
      }
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const item = queue[cursor++]!;
          const floors = categoryFloors(item.signals, sections, taxonomy);
          const input: ContextInput = {
            unit: item.unit,
            signals: item.signals,
            versions: item.versions,
            readText: (side) => readText(item.patch, side),
            retriever: retrieval!.retriever,
            related: retrieval!.related,
            categoryRules: floors.flatMap((floor) => floor.rules),
            sectionsById,
            ...(options.taskId ? { taskId: options.taskId } : {}),
          };
          assessments.set(item.unit.id, await engine!.assess(input));
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.llmConcurrency ?? SEMANTIC_CONCURRENCY, queue.length) }, worker));
      engine?.cacheSave();
    });
    if (engine?.disabledReason) warnings.push(`LLM desactivado durante la auditoría: ${engine.disabledReason}`);
    else if (engine && engine.errors.length > 0) warnings.push(...engine.errors.map((error) => `LLM: ${error}`));

    const findings = await metrics.time("decision", async () => {
      const testUnits = withSignals.filter((item) => item.signals.some((signal) => signal.category === "tests"));
      const decisions: Decision[] = withSignals.map((item) =>
        decide({
          unit: item.unit,
          signals: item.signals,
          taxonomy,
          sections,
          semantic: assessments.get(item.unit.id) ?? null,
          relatedTests: relatedTests(item.unit, item.signals, testUnits),
          ...(skipped.get(item.unit.id) ? { skippedLlmReason: skipped.get(item.unit.id) } : {}),
        }),
      );
      return assignIds(decisions, taxonomy);
    });

    const data = metrics.data;
    data.filesChanged = changes.patches.length;
    data.unitsTotal = findings.length;
    data.unitsWithoutLlm = findings.filter((finding) => !finding.semantic).length;
    data.linesTotal = withSignals.reduce((total, item) => total + item.unit.lines.length, 0);
    data.linesPrioritized = prioritizedLines(findings, withSignals.map((item) => item.unit));
    data.index = { ...index.stats };

    const run: AuditRun = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      id: newAuditId(now),
      createdAt: now.toISOString(),
      repo: { root: repoRoot, name: path.basename(repoRoot) },
      mode: changes.mode,
      base: changes.base,
      head: changes.head,
      baseSha: changes.baseSha,
      headSha: changes.headSha,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.planPath ? { planPath: options.planPath } : {}),
      taxonomyVersion: taxonomy.version,
      categories: taxonomy.categories.map((category) => ({ id: category.id, prefix: category.prefix, label: category.label })),
      llm: engine ? { provider: engine.provider, model: engine.model, promptVersion: engine.promptVersion } : null,
      units: withSignals.map((item) => item.unit),
      findings,
      summary: summarize(findings),
      metrics: data,
      warnings,
    };
    if (options.write !== false) await metrics.time("report", async () => writeAudit(repoRoot, run));
    index.save();
    return { run, taxonomy };
  } finally {
    index.dispose();
  }
}

async function fileVersions(
  index: RepoIndex,
  repoRoot: string,
  baseSha: string,
  headSha: string,
  patch: FilePatch,
  git: GitRunner,
): Promise<FileVersions> {
  const previous = patch.previousPath ?? patch.path;
  const base =
    patch.status === "added" ? null : await index.ensureBlob(patch.oldBlob, previous, () => readVersion(repoRoot, baseSha, previous, patch.oldBlob, git));
  const head =
    patch.status === "deleted" ? null : await index.ensureBlob(patch.newBlob, patch.path, () => readVersion(repoRoot, headSha, patch.path, patch.newBlob, git));
  return { base, head };
}

/** Tests cambiados en el mismo diff que mencionan el módulo (`players.views`, `players/views`) o el símbolo. */
function relatedTests(unit: ChangeUnit, signals: readonly Signal[], testUnits: ReadonlyArray<{ unit: ChangeUnit }>): string[] {
  if (signals.some((signal) => signal.category === "tests")) return [];
  const stem = unit.file.replace(/\.[^./]+$/, "").replace(/\/index$|\/__init__$/, "");
  const needles = [stem.replace(/\//g, "."), stem];
  const symbolName = unit.symbol?.qualifiedName.split(".").pop();
  const words = [symbolName, unit.symbol?.qualifiedName.split(".")[0]].filter((word): word is string => Boolean(word && word.length >= 4));
  const related = new Set<string>();
  for (const { unit: test } of testUnits) {
    const text = test.lines.map((line) => line.text).join("\n");
    if (needles.some((needle) => text.includes(needle)) || words.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text))) {
      related.add(test.file);
    }
  }
  return [...related].sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Líneas en unidades que piden atención: crítica, alta, media o desconocida. */
function prioritizedLines(findings: readonly Finding[], units: readonly ChangeUnit[]): number {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  return findings
    .filter((finding) => finding.criticality === "unknown" || CRITICALITY_RANK[finding.criticality] >= CRITICALITY_RANK.medium)
    .reduce((total, finding) => total + (byId.get(finding.unitId)?.lines.length ?? 0), 0);
}
