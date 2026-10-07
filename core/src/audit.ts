import type { LineRange } from "./protocol.js";
import type { TokenUsage } from "./playground.js";

/**
 * Tipos compartidos del auditor de cambios hechos por agentes IA (`auditor/` los produce, `web/` los muestra).
 * El JSON sidecar (`.archtrace/audits/<id>.json`) es un `AuditRun` serializado tal cual: es la fuente de verdad
 * y `Auditoria.md` se regenera a partir de él.
 */

export const AUDIT_SCHEMA_VERSION = 1;

/** De mayor a menor. `unknown` = el auditor no pudo decidir con evidencia suficiente: requiere revisión humana. */
export type Criticality = "critical" | "high" | "medium" | "low" | "unknown";

export const CRITICALITIES: readonly Criticality[] = ["critical", "high", "medium", "low", "unknown"];

/** Rango para comparar suelos: `unknown` no es un nivel, se trata aparte. */
export const CRITICALITY_RANK: Readonly<Record<Criticality, number>> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

export const CRITICALITY_LABEL: Readonly<Record<Criticality, string>> = {
  critical: "CRÍTICA",
  high: "ALTA",
  medium: "MEDIA",
  low: "BAJA",
  unknown: "DESCONOCIDA",
};

export type ReviewStatus = "pending" | "reviewed" | "accepted" | "rejected" | "false_positive";

export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "reviewed", "accepted", "rejected", "false_positive"];

/**
 * - `range`: `base..head` explícitos.
 * - `commit`: un commit frente a su padre (por defecto `HEAD`).
 * - `branch`: `merge-base(base, HEAD)` frente a `HEAD` (lo que añadió la rama).
 * - `worktree`: `HEAD` frente al árbol de trabajo, incluidos los archivos sin seguimiento.
 */
export type AuditMode = "range" | "commit" | "branch" | "worktree";

export const AUDIT_MODES: readonly AuditMode[] = ["range", "commit", "branch", "worktree"];

/** Valor de `headSha` cuando la cabeza es el árbol de trabajo (no hay commit). */
export const WORKTREE_REF = "WORKTREE";

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** Una línea cambiada. `line` es 1-based: en la versión head para `add`, en la base para `del`. */
export interface DiffLine {
  kind: "add" | "del";
  line: number;
  text: string;
}

export type DiffSide = "base" | "head";

/** Unidad mínima de revisión: los hunks de un archivo que caen en el mismo símbolo (o en el ámbito del módulo). */
export interface ChangeUnit {
  /** Estable: hash de archivo + símbolo + contenido de los hunks. Clave de caché del LLM. */
  id: string;
  file: string;
  previousPath?: string;
  status: FileChangeStatus;
  /** `null` = sin gramática tree-sitter (YAML, SQL, CSS…): se analiza por ruta + hunk. */
  language: string | null;
  /** Símbolo envolvente (`Clase.metodo`), o `null` si el cambio está en el ámbito del módulo. */
  symbol: { qualifiedName: string; kind: "class" | "function" | "method"; side: DiffSide; range: LineRange } | null;
  /** Líneas tocadas en la versión head (null si solo hay borrados). */
  headLines: LineRange | null;
  /** Líneas tocadas en la versión base (null si solo hay añadidos). */
  baseLines: LineRange | null;
  added: number;
  removed: number;
  lines: DiffLine[];
  /** Cabeceras `@@ … @@` de los hunks que forman la unidad. */
  hunkHeaders: string[];
}

export type SignalStrength = "strong" | "weak";

/** Coincidencia determinista de un detector sobre una línea cambiada o sobre la ruta. */
export interface Signal {
  detector: string;
  category: string;
  strength: SignalStrength;
  /** Suelo de criticidad que impone el detector (el LLM no puede bajar de aquí). */
  floor: Criticality;
  /** Texto que disparó el detector (`has_perm`, `stripe`, `.css`). */
  token: string;
  /** 0 = señal de ruta, no de línea. */
  line: number;
  side: DiffSide | "path";
  text: string;
}

export type FieldOrigin = "rule" | "llm" | "both" | "none";

export interface Evidence {
  file: string;
  line: number;
  side: DiffSide;
  text: string;
  source: "rule" | "llm";
}

/** Referencia a una sección de documentación del repo (`CLAUDE.md#authorization`). */
export interface RuleRef {
  sectionId: string;
  file: string;
  headingPath: string[];
  lines: LineRange;
  /** Frase de tipo regla citada ("Los cambios de permisos son críticos…"). */
  excerpt: string;
  /** `category`: la sección encaja con la categoría del hallazgo. `llm`: la citó el modelo y se validó. */
  matchedBy: "category" | "llm";
  /** La frase marca el cambio como crítico / con revisión obligatoria. */
  critical: boolean;
}

/** Salida del LLM ya validada y normalizada (lo descartado queda contado en `dropped`). */
export interface SemanticAssessment {
  provider: string;
  model: string;
  promptVersion: string;
  category: string;
  criticality: Criticality;
  confidence: number;
  reason: string;
  evidence: Array<{ line: number; text: string }>;
  ruleRefs: string[];
  needsMoreContext: boolean;
  contextLevel: number;
  escalations: number;
  cached: boolean;
  usage?: TokenUsage;
  dropped: { evidence: number; ruleRefs: number; invalidCategory: boolean };
}

export interface FindingReview {
  status: ReviewStatus;
  note?: string;
  updatedAt?: string;
}

export interface Finding {
  /** Id legible por categoría: `AUTHZ-001`. Estable dentro de una auditoría. */
  id: string;
  unitId: string;
  file: string;
  symbol: string | null;
  side: DiffSide;
  lines: LineRange;
  /** Id de la taxonomía o `unknown`. */
  category: string;
  criticality: Criticality;
  /** 0..1 */
  confidence: number;
  reason: string;
  signals: Signal[];
  evidence: Evidence[];
  rules: RuleRef[];
  semantic?: SemanticAssessment;
  origin: { category: FieldOrigin; criticality: FieldOrigin; reason: FieldOrigin };
  humanReviewRequired: boolean;
  /** Nivel de contexto alcanzado (0 = solo hunk; -1 = resuelto sin LLM). */
  contextLevel: number;
  /** Tests modificados en el mismo diff que tocan el símbolo o el módulo. */
  relatedTests: string[];
  review: FindingReview;
}

export interface AuditMetrics {
  llmCalls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  /** true si algún proveedor no informó del consumo y se estimó por longitud. */
  tokensEstimated: boolean;
  /** Tokens de contexto enviados por nivel (índice = nivel). */
  contextTokensByLevel: number[];
  stageMs: Record<string, number>;
  filesChanged: number;
  linesTotal: number;
  /** Líneas en hallazgos que piden atención (crítica, alta, media o desconocida). */
  linesPrioritized: number;
  unitsTotal: number;
  unitsWithoutLlm: number;
  index: { blobsParsed: number; blobsReused: number; docsParsed: number; docsReused: number };
  /** Recuperación de reglas: `hybrid` = BM25 + vectores (Qdrant + Ollama); `bm25` = solo léxica. */
  retrieval: { mode: "bm25" | "hybrid"; embedded: number; reused: number };
}

export interface AuditRun {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  repo: { root: string; name: string };
  mode: AuditMode;
  /** Refs tal como se pidieron. */
  base: string;
  head: string;
  baseSha: string;
  /** SHA del commit head o `WORKTREE`. */
  headSha: string;
  taskId?: string;
  planPath?: string;
  taxonomyVersion: string;
  /** Categorías de la taxonomía usada (para etiquetas en informe y UI sin cargar la taxonomía). */
  categories: Array<{ id: string; prefix: string; label: string }>;
  llm: { provider: string; model: string; promptVersion: string } | null;
  units: ChangeUnit[];
  findings: Finding[];
  summary: Record<Criticality, number>;
  metrics: AuditMetrics;
  warnings: string[];
}

/** Resumen para listados (historial) sin cargar unidades ni hallazgos. */
export interface AuditListItem {
  id: string;
  createdAt: string;
  mode: AuditMode;
  base: string;
  head: string;
  headSha: string;
  taskId?: string;
  summary: Record<Criticality, number>;
  reviewed: number;
  total: number;
}

export function emptySummary(): Record<Criticality, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
}

export function maxCriticality(left: Criticality, right: Criticality): Criticality {
  return CRITICALITY_RANK[left] >= CRITICALITY_RANK[right] ? left : right;
}

/** Orden de la cola de revisión: criticidad (desconocida tras alta: pide revisión humana) y después confianza. */
export const QUEUE_ORDER: Readonly<Record<Criticality, number>> = { critical: 0, high: 1, unknown: 2, medium: 3, low: 4 };

export function compareFindings(left: Finding, right: Finding): number {
  return (
    QUEUE_ORDER[left.criticality] - QUEUE_ORDER[right.criticality] ||
    right.confidence - left.confidence ||
    left.file.localeCompare(right.file) ||
    left.lines.startLine - right.lines.startLine
  );
}

/* ---------- API HTTP del auditor (127.0.0.1:8090) ---------- */

export const AUDITOR_DEFAULT_PORT = 8090;

export interface AuditorRepo {
  id: string;
  root: string;
  name: string;
  addedAt: string;
  /** false si la carpeta ya no existe (repo movido o borrado). */
  available?: boolean;
}

export interface AuditorRefs {
  current: string | null;
  branches: string[];
  commits: Array<{ sha: string; subject: string; date: string }>;
  dirty: boolean;
}

/** Selección BYOK que viaja en cada petición y nunca se persiste en el auditor. */
export interface AuditorAiSelection {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * `ai`: selección BYOK del navegador; `"env"` = claves del entorno del propio auditor (`auditor/.env`);
 * null/ausente = solo reglas deterministas.
 */
export interface CreateAuditRequest {
  mode: AuditMode;
  base?: string;
  head?: string;
  taskId?: string;
  planPath?: string;
  ai?: AuditorAiSelection | "env" | null;
}

export interface AuditorHealth {
  ok: boolean;
  service: "archtrace-auditor";
  /** Proveedor y modelo que usaría `ai: "env"` (nunca la clave), o null si no hay claves en su entorno. */
  envProvider: { provider: string; model: string } | null;
}

export interface ReviewPatchRequest {
  status: ReviewStatus;
  note?: string;
}

export interface FileVersionResponse {
  path: string;
  side: DiffSide;
  /** `null` si no existe en ese lado (alta o baja) o es binario. */
  content: string | null;
}
