import {
  AUDITOR_DEFAULT_PORT,
  type AuditListItem,
  type AuditorHealth,
  type AuditorRefs,
  type AuditorRepo,
  type AuditRun,
  type CreateAuditRequest,
  type DiffSide,
  type FileVersionResponse,
  type Finding,
  type ReviewPatchRequest,
} from "@core/audit";

/**
 * Cliente HTTP del auditor local (`auditor/`, 127.0.0.1:8090). Separado de la UI: sin React ni estado.
 * El web solo habla con el auditor por esta API; la clave BYOK viaja en `CreateAuditRequest.ai` y el auditor
 * no la guarda.
 */
export const AUDITOR_URL = (process.env.NEXT_PUBLIC_AUDITOR_URL?.trim() || `http://127.0.0.1:${AUDITOR_DEFAULT_PORT}`).replace(/\/+$/, "");

export class AuditorError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AuditorError";
  }
}

type Fetch = typeof fetch;

export interface AuditorClient {
  /** null = el auditor no responde. */
  health(): Promise<AuditorHealth | null>;
  listRepos(): Promise<AuditorRepo[]>;
  linkRepo(path: string): Promise<{ repo: AuditorRepo; docSections: number }>;
  unlinkRepo(repoId: string): Promise<void>;
  refs(repoId: string): Promise<AuditorRefs>;
  listAudits(repoId: string): Promise<AuditListItem[]>;
  createAudit(repoId: string, request: CreateAuditRequest, signal?: AbortSignal): Promise<AuditRun>;
  getAudit(repoId: string, auditId: string): Promise<AuditRun>;
  reviewFinding(repoId: string, auditId: string, findingId: string, patch: ReviewPatchRequest): Promise<Finding>;
  fileVersion(repoId: string, auditId: string, side: DiffSide, path: string): Promise<FileVersionResponse>;
}

export function createAuditorClient(baseUrl = AUDITOR_URL, fetchImpl: Fetch = (...args) => fetch(...args)): AuditorClient {
  async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
    const { json, ...rest } = init ?? {};
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...rest,
        headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new AuditorError(
        `No se pudo contactar con el auditor en ${baseUrl}. Arráncalo con \`cd auditor && npm run serve\`.`,
        null,
      );
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `El auditor respondió HTTP ${response.status}.`;
      throw new AuditorError(message, response.status);
    }
    return body as T;
  }

  const repoPath = (repoId: string) => `/repos/${encodeURIComponent(repoId)}`;

  return {
    async health() {
      try {
        const health = await call<AuditorHealth>("/health");
        return health.ok === true ? health : null;
      } catch {
        return null;
      }
    },
    async listRepos() {
      return (await call<{ repos: AuditorRepo[] }>("/repos")).repos;
    },
    linkRepo(path) {
      return call("/repos", { method: "POST", json: { path } });
    },
    async unlinkRepo(repoId) {
      await call(repoPath(repoId), { method: "DELETE" });
    },
    refs(repoId) {
      return call(`${repoPath(repoId)}/refs`);
    },
    async listAudits(repoId) {
      return (await call<{ audits: AuditListItem[] }>(`${repoPath(repoId)}/audits`)).audits;
    },
    createAudit(repoId, request, signal) {
      return call(`${repoPath(repoId)}/audits`, { method: "POST", json: request, signal });
    },
    getAudit(repoId, auditId) {
      return call(`${repoPath(repoId)}/audits/${encodeURIComponent(auditId)}`);
    },
    reviewFinding(repoId, auditId, findingId, patch) {
      return call(`${repoPath(repoId)}/audits/${encodeURIComponent(auditId)}/findings/${encodeURIComponent(findingId)}`, { method: "PATCH", json: patch });
    },
    fileVersion(repoId, auditId, side, path) {
      const query = new URLSearchParams({ audit: auditId, side, path });
      return call(`${repoPath(repoId)}/files?${query.toString()}`);
    },
  };
}

export const auditorClient = createAuditorClient();
