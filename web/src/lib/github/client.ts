/**
 * Cliente mínimo de la API REST de GitHub. Todas las peticiones salen DIRECTAMENTE del navegador
 * hacia `api.github.com` con el PAT del usuario: no pasan por ningún backend propio.
 */

const API = "https://api.github.com";
const TOKEN_KEY = "teacher:github-pat";

export interface RepoRef {
  owner: string;
  repo: string;
  /** Rama, tag o commit. Vacío = rama por defecto del repo. */
  ref?: string;
}

export interface TreeEntry {
  path: string;
  sha: string;
  size: number;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

/** Acepta `owner/repo`, `owner/repo@rama` o una URL de github.com (incluida `/tree/<rama>`). */
export function parseRepoRef(input: string): RepoRef | null {
  const raw = input.trim().replace(/\.git$/, "");
  const url = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^\s#?]+))?/i);
  if (url) return clean(url[1], url[2], url[3]);
  const short = raw.match(/^([^/\s@]+)\/([^/\s@]+)(?:@(\S+))?$/);
  return short ? clean(short[1], short[2], short[3]) : null;
}

function clean(owner: string | undefined, repo: string | undefined, ref: string | undefined): RepoRef | null {
  const valid = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null;
  return ref ? { owner, repo, ref: decodeURIComponent(ref) } : { owner, repo };
}

// El token solo vive en sessionStorage de esta pestaña: se borra al cerrarla y nunca se envía a un servidor propio.
export function readSessionToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveSessionToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sin sessionStorage (modo privado estricto): el token solo dura lo que la importación.
  }
}

function headers(token: string, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path: string, token: string, signal: AbortSignal | undefined, accept?: string): Promise<Response> {
  // `credentials: "omit"` + `referrerPolicy`: nada de cookies ni de la URL de la app hacia GitHub.
  const response = await fetch(`${API}${path}`, {
    headers: headers(token, accept),
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (response.ok) return response;
  if (response.status === 401) throw new GithubError("El token no es válido o ha caducado.", 401);
  if (response.status === 404)
    throw new GithubError("No se encontró el repositorio o el token no tiene acceso (permiso «Contents: read»).", 404);
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new GithubError(
      remaining === "0" ? "Límite de peticiones de GitHub agotado. Usa un token o espera unos minutos." : "GitHub denegó el acceso (403).",
      response.status,
    );
  }
  throw new GithubError(`GitHub respondió ${response.status}.`, response.status);
}

const enc = encodeURIComponent;

/** Resuelve la rama por defecto si no se indicó y devuelve el árbol completo (solo archivos). */
export async function fetchRepoTree(
  repo: RepoRef,
  token: string,
  signal?: AbortSignal,
): Promise<{ ref: string; isPrivate: boolean; truncated: boolean; files: TreeEntry[] }> {
  const meta = (await (await request(`/repos/${enc(repo.owner)}/${enc(repo.repo)}`, token, signal)).json()) as {
    default_branch: string;
    private: boolean;
  };
  const ref = repo.ref || meta.default_branch;
  const tree = (await (
    await request(`/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees/${enc(ref)}?recursive=1`, token, signal)
  ).json()) as { truncated: boolean; tree: { path: string; type: string; sha: string; size?: number }[] };
  const files = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 }));
  return { ref, isPrivate: meta.private, truncated: tree.truncated, files };
}

/** Contenido de un blob como texto (formato raw: sin base64). */
export async function fetchBlobText(repo: RepoRef, sha: string, token: string, signal?: AbortSignal): Promise<string> {
  const response = await request(
    `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/blobs/${enc(sha)}`,
    token,
    signal,
    "application/vnd.github.raw+json",
  );
  return response.text();
}
