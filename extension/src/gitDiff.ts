import { execFile } from "node:child_process";
import path from "node:path";
import type { GitCommitRef, GitDiffPayload, GitFileChange, GitRefsPayload } from "@core/protocol";

/**
 * Git para el diff visual del lienzo. Guardarraíles:
 * - Siempre `execFile` con argumentos (sin shell) y `--` antes de rutas.
 * - Los refs se validan: nada que empiece por `-` (no se pueden colar opciones) ni caracteres raros.
 * - Las rutas se devuelven relativas al workspace; lo que queda fuera de él se descarta.
 */

const GIT_TIMEOUT_MS = 8000;
const MAX_FILES = 2000;
const MAX_COMMITS = 30;
const MAX_BRANCHES = 100;

/** Rama, tag, SHA o expresiones simples (`HEAD~3`, `origin/main`). */
const REF = /^(?!-)[A-Za-z0-9._/@~^{}-]{1,200}$/;

export function isSafeRef(ref: string): boolean {
  return REF.test(ref) && !ref.includes("..") && !ref.includes("@{");
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });

const STATUS: Readonly<Record<string, GitFileChange["status"]>> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "modified" };

/**
 * `git diff --name-status -M -z` → cambios. Con `-z` los campos van separados por NUL: `R100\0viejo\0nuevo`.
 * `toWorkspace` traduce una ruta del repo a una relativa al workspace (null = fuera del workspace).
 */
export function parseNameStatus(stdout: string, toWorkspace: (repoPath: string) => string | null): GitFileChange[] {
  const fields = stdout.split("\0").filter((field) => field.length > 0);
  const changes: GitFileChange[] = [];
  for (let index = 0; index < fields.length && changes.length < MAX_FILES; ) {
    const code = fields[index] ?? "";
    const status = STATUS[code[0] ?? ""];
    const twoPaths = code.startsWith("R") || code.startsWith("C");
    const first = fields[index + 1];
    const second = twoPaths ? fields[index + 2] : undefined;
    index += twoPaths ? 3 : 2;
    if (!status || first === undefined) continue;
    const current = toWorkspace(twoPaths && second !== undefined ? second : first);
    if (current === null) continue;
    const change: GitFileChange = { path: current, status };
    if (status === "renamed") {
      const previous = toWorkspace(first);
      if (previous !== null) change.previousPath = previous;
    }
    changes.push(change);
  }
  return changes;
}

/** Traductor repo → workspace, a partir de la raíz del repo (`git rev-parse --show-toplevel`). */
export function workspaceMapper(repoRoot: string, workspaceRoot: string): (repoPath: string) => string | null {
  return (repoPath) => {
    const absolute = path.resolve(repoRoot, repoPath);
    const relative = path.relative(workspaceRoot, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
  };
}

export async function gitRefs(workspaceRoot: string, git: GitRunner = runGit): Promise<Omit<GitRefsPayload, "requestId">> {
  try {
    const [current, branches, log] = await Promise.all([
      git(["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot),
      git(["for-each-ref", "--format=%(refname:short)", `--count=${MAX_BRANCHES}`, "refs/heads", "refs/remotes"], workspaceRoot),
      git(["log", `-n${MAX_COMMITS}`, "--format=%H%x1f%s%x1f%cI"], workspaceRoot),
    ]);
    const commits: GitCommitRef[] = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = "", date = ""] = line.split("\x1f");
        return { sha, subject: subject.slice(0, 200), date };
      })
      .filter((commit) => /^[0-9a-f]{7,64}$/.test(commit.sha));
    const head = current.trim();
    return {
      current: head && head !== "HEAD" ? head : null,
      branches: branches.split("\n").map((line) => line.trim()).filter((name) => name && isSafeRef(name) && !name.endsWith("/HEAD")),
      commits,
    };
  } catch (error) {
    return { current: null, branches: [], commits: [], error: error instanceof Error ? error.message : "git no disponible" };
  }
}

export async function gitDiff(
  workspaceRoot: string,
  base: string,
  head: string | null,
  git: GitRunner = runGit,
): Promise<Omit<GitDiffPayload, "requestId">> {
  if (!isSafeRef(base) || (head !== null && !isSafeRef(head))) {
    return { base, head, files: [], error: "Ref no válido." };
  }
  try {
    const repoRoot = (await git(["rev-parse", "--show-toplevel"], workspaceRoot)).trim();
    const args = ["diff", "--name-status", "-M", "-z", base, ...(head ? [head] : []), "--"];
    const stdout = await git(args, workspaceRoot);
    return { base, head, files: parseNameStatus(stdout, workspaceMapper(repoRoot, workspaceRoot)) };
  } catch (error) {
    return { base, head, files: [], error: error instanceof Error ? error.message.slice(0, 300) : "git diff falló" };
  }
}
