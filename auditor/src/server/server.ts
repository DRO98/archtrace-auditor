import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AUDIT_MODES,
  AUDITOR_DEFAULT_PORT,
  type AuditMode,
  type AuditorHealth,
  type AuditorRefs,
  type CreateAuditRequest,
  type DiffSide,
  type FileVersionResponse,
} from "@core/audit";
import { isSafeRef } from "@core/gitRef";
import { createProvider, createProviderFromEnv, readSelection } from "@llm/index";
import { AiError } from "@llm/types";
import { GitError, readVersion, repoToplevel } from "../git/changes";
import { runGit, type GitRunner } from "../git/run";
import { RepoIndex } from "../index/repoIndex";
import { archtraceHome } from "../paths";
import { runAudit } from "../pipeline";
import { isAuditId, isReviewStatus, listAudits, readAudit, updateReview } from "../report/store";
import { RepoRegistry, type RegisteredRepo } from "./registry";

export interface AuditorServerOptions {
  host?: string;
  port?: number;
  /** Mismo criterio que la extensión: solo estos `Origin` de navegador. */
  allowedOrigins?: readonly string[];
  home?: string;
  git?: GitRunner;
  log?: (message: string) => void;
}

export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * API HTTP local del auditor. Seguridad:
 * - Escucha en loopback; `Host` debe ser loopback (frena DNS rebinding).
 * - `Origin` presente → debe estar en la lista; sin `Origin` (curl, CLI) se acepta.
 * - Escrituras solo con `Content-Type: application/json` (un formulario de otra web no puede enviarlo sin preflight).
 * - La clave BYOK llega en el cuerpo de `POST /audits`, se usa en memoria y nunca se guarda ni se registra.
 */
export function createAuditorServer(options: AuditorServerOptions = {}): Server {
  const home = options.home ?? archtraceHome();
  const git = options.git ?? runGit;
  const allowed = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const registry = new RepoRegistry(home);
  const running = new Set<string>();
  const log = options.log ?? (() => undefined);

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : error instanceof GitError ? 400 : 500;
      const message = error instanceof Error ? error.message : "Error interno";
      if (status === 500) log(`[auditor] ${request.method} ${request.url}: ${message}`);
      send(response, status, { error: message });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    const hostHeader = request.headers.host ?? "";
    const hostname = hostHeader.replace(/:\d+$/, "").toLowerCase();
    if (!LOOPBACK_HOSTS.has(hostname)) throw new HttpError(403, "Host no permitido.");
    if (origin !== undefined) {
      if (!allowed.has(origin)) throw new HttpError(403, "Origin no permitido.");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "content-type");
      response.setHeader("Access-Control-Max-Age", "600");
      if (request.headers["access-control-request-private-network"] === "true") response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/health") {
      const env = createProviderFromEnv();
      const health: AuditorHealth = { ok: true, service: "archtrace-auditor", envProvider: env ? { provider: env.id, model: env.model } : null };
      return send(response, 200, health);
    }

    if (parts[0] !== "repos") throw new HttpError(404, "Ruta no encontrada.");

    if (parts.length === 1) {
      if (method === "GET") return send(response, 200, { repos: registry.list() });
      if (method === "POST") {
        const body = await readJson(request);
        const target = typeof body.path === "string" ? body.path.trim() : "";
        if (!target) throw new HttpError(400, "Falta `path`.");
        const root = await repoToplevel(target, git);
        const repo = registry.add(root);
        const index = RepoIndex.load(root, { home });
        try {
          const stats = await index.refresh(git);
          index.save();
          return send(response, 201, { repo, index: stats, docSections: index.docSections().length });
        } finally {
          index.dispose();
        }
      }
      throw new HttpError(405, "Método no permitido.");
    }

    const repo = registry.get(parts[1]!);
    if (!repo) throw new HttpError(404, "Repo no vinculado.");

    if (parts.length === 2 && method === "DELETE") {
      // Solo lo desvincula: no toca el repo ni sus auditorías.
      registry.remove(repo.id);
      return send(response, 200, { removed: repo.id });
    }

    if (parts[2] === "refs" && parts.length === 3 && method === "GET") return send(response, 200, await repoRefs(repo, git));

    if (parts[2] === "files" && parts.length === 3 && method === "GET") return send(response, 200, await fileVersion(repo, url, git));

    if (parts[2] !== "audits") throw new HttpError(404, "Ruta no encontrada.");

    if (parts.length === 3) {
      if (method === "GET") return send(response, 200, { audits: listAudits(repo.root) });
      if (method === "POST") {
        const body = (await readJson(request)) as Partial<CreateAuditRequest>;
        const mode = body.mode as AuditMode;
        if (!AUDIT_MODES.includes(mode)) throw new HttpError(400, "`mode` no válido.");
        for (const ref of [body.base, body.head]) {
          if (ref !== undefined && (typeof ref !== "string" || !isSafeRef(ref))) throw new HttpError(400, "Ref no válido.");
        }
        let provider = null;
        if (body.ai === "env") {
          provider = createProviderFromEnv();
          if (!provider) throw new HttpError(400, "El auditor no tiene claves en su entorno: crea auditor/.env (ver auditor/.env.example) y reinícialo.");
        } else if (body.ai) {
          // Selección explícita: nunca se cae a otro proveedor ni a las claves del entorno de otro proveedor.
          const selection = readSelection(body.ai);
          provider = selection ? createProvider(selection) : null;
          if (!provider) {
            throw new HttpError(
              400,
              selection
                ? `Falta la clave de ${selection.provider}: pégala en API & Integración o ponla en auditor/.env.`
                : "Proveedor de IA no válido.",
            );
          }
        }
        if (running.has(repo.id)) throw new HttpError(409, "Ya hay una auditoría en curso para este repo.");
        running.add(repo.id);
        try {
          const { run } = await runAudit({
            repo: repo.root,
            mode,
            ...(body.base ? { base: body.base } : {}),
            ...(body.head ? { head: body.head } : {}),
            ...(typeof body.taskId === "string" && body.taskId.trim() ? { taskId: body.taskId.trim().slice(0, 200) } : {}),
            ...(typeof body.planPath === "string" && body.planPath.trim() ? { planPath: body.planPath.trim().slice(0, 300) } : {}),
            provider,
            home,
            git,
          });
          log(`[auditor] ${repo.name}: auditoría ${run.id} (${run.findings.length} hallazgos, ${run.metrics.llmCalls} llamadas LLM)`);
          return send(response, 201, run);
        } catch (error) {
          if (error instanceof AiError) throw new HttpError(502, error.hint);
          throw error;
        } finally {
          running.delete(repo.id);
        }
      }
      throw new HttpError(405, "Método no permitido.");
    }

    const auditId = parts[3]!;
    if (!isAuditId(auditId)) throw new HttpError(400, "Id de auditoría no válido.");

    if (parts.length === 4 && method === "GET") {
      const run = readAudit(repo.root, auditId);
      if (!run) throw new HttpError(404, "Auditoría no encontrada.");
      return send(response, 200, run);
    }

    if (parts.length === 6 && parts[4] === "findings" && method === "PATCH") {
      const body = await readJson(request);
      if (!isReviewStatus(body.status)) throw new HttpError(400, "`status` no válido.");
      if (body.note !== undefined && typeof body.note !== "string") throw new HttpError(400, "`note` debe ser texto.");
      try {
        const finding = updateReview(repo.root, auditId, parts[5]!, { status: body.status, ...(typeof body.note === "string" ? { note: body.note } : {}) });
        return send(response, 200, finding);
      } catch (error) {
        throw new HttpError(404, error instanceof Error ? error.message : "No encontrado.");
      }
    }
    throw new HttpError(404, "Ruta no encontrada.");
  }

  return server;
}

export function listen(server: Server, options: Pick<AuditorServerOptions, "host" | "port"> = {}): Promise<{ host: string; port: number }> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? AUDITOR_DEFAULT_PORT;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ host, port: typeof address === "object" && address ? address.port : port });
    });
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const type = request.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Se espera application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Cuerpo demasiado grande.");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON no válido.");
  }
}

/** Contenido de un archivo de la auditoría para el visor de diff: solo rutas que aparecen en esa auditoría. */
async function fileVersion(repo: RegisteredRepo, url: URL, git: GitRunner): Promise<FileVersionResponse> {
  const auditId = url.searchParams.get("audit") ?? "";
  const side = url.searchParams.get("side") as DiffSide;
  const file = url.searchParams.get("path") ?? "";
  if (!isAuditId(auditId)) throw new HttpError(400, "Id de auditoría no válido.");
  if (side !== "base" && side !== "head") throw new HttpError(400, "`side` debe ser base o head.");
  const run = readAudit(repo.root, auditId);
  if (!run) throw new HttpError(404, "Auditoría no encontrada.");
  const unit = run.units.find((candidate) => candidate.file === file || candidate.previousPath === file);
  if (!unit) throw new HttpError(403, "Ese archivo no forma parte de la auditoría.");
  if ((side === "base" && unit.status === "added") || (side === "head" && unit.status === "deleted")) return { path: file, side, content: null };
  const target = side === "base" ? (unit.previousPath ?? unit.file) : unit.file;
  const commit = side === "base" ? run.baseSha : run.headSha;
  const content = await readVersion(repo.root, commit, target, undefined, git);
  return { path: target, side, content };
}

async function repoRefs(repo: RegisteredRepo, git: GitRunner): Promise<AuditorRefs> {
  const safe = async (args: string[]) => {
    try {
      return await git(args, repo.root);
    } catch {
      return "";
    }
  };
  const [current, branches, log, status] = await Promise.all([
    safe(["rev-parse", "--abbrev-ref", "HEAD"]),
    safe(["for-each-ref", "--format=%(refname:short)", "--count=100", "refs/heads", "refs/remotes"]),
    safe(["log", "-n30", "--format=%H%x1f%s%x1f%cI"]),
    safe(["status", "--porcelain", "-z", "--untracked-files=normal"]),
  ]);
  const head = current.trim();
  const dirty = status
    .split("\0")
    .filter(Boolean)
    .some((entry) => !/ (Auditoria\.md|\.archtrace\/.*)$/.test(entry));
  return {
    current: head && head !== "HEAD" ? head : null,
    branches: branches.split("\n").map((line) => line.trim()).filter((name) => name && isSafeRef(name) && !name.endsWith("/HEAD")),
    commits: log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = "", date = ""] = line.split("\x1f");
        return { sha, subject: subject.slice(0, 200), date };
      })
      .filter((commit) => /^[0-9a-f]{7,64}$/.test(commit.sha)),
    dirty,
  };
}

