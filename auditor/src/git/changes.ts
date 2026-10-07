import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WORKTREE_REF, type AuditMode, type DiffLine } from "@core/audit";
import { isSafeRef } from "@core/gitRef";
import { parseUnifiedDiff, type FilePatch } from "./patch";
import { runGit, type GitRunner } from "./run";

export interface ChangeRequest {
  mode: AuditMode;
  base?: string;
  head?: string;
}

export interface ChangeSet {
  repoRoot: string;
  mode: AuditMode;
  base: string;
  head: string;
  baseSha: string;
  /** SHA del commit head o `WORKTREE`. */
  headSha: string;
  patches: FilePatch[];
  warnings: string[];
}

/** Artefactos del propio auditor: escribirlos genera un cambio git que no debe auditarse. */
export const AUDITOR_ARTIFACTS = ["Auditoria.md", ".archtrace/"];

const MAX_FILES = 2000;
const MAX_UNTRACKED_BYTES = 512 * 1024;

export function isAuditorArtifact(repoPath: string): boolean {
  return AUDITOR_ARTIFACTS.some((artifact) => (artifact.endsWith("/") ? repoPath.startsWith(artifact) : repoPath === artifact));
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export async function repoToplevel(directory: string, git: GitRunner = runGit): Promise<string> {
  try {
    return path.resolve((await git(["rev-parse", "--show-toplevel"], directory)).trim());
  } catch {
    throw new GitError(`No es un repositorio git: ${directory}`);
  }
}

/** Resuelve un ref de usuario a SHA de commit. Rechaza todo lo que no pase `isSafeRef`. */
export async function resolveCommit(repoRoot: string, ref: string, git: GitRunner = runGit): Promise<string> {
  if (!isSafeRef(ref)) throw new GitError(`Ref no válido: ${ref}`);
  try {
    return (await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], repoRoot)).trim();
  } catch {
    throw new GitError(`No existe el commit: ${ref}`);
  }
}

async function emptyTree(repoRoot: string, git: GitRunner): Promise<string> {
  return (await git(["hash-object", "-t", "tree", "--stdin"], repoRoot, "")).trim();
}

async function hasHead(repoRoot: string, git: GitRunner): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], repoRoot);
    return true;
  } catch {
    return false;
  }
}

/** Base y cabeza (SHAs) según el modo. La base de un commit raíz es el árbol vacío. */
async function resolveEndpoints(
  repoRoot: string,
  request: ChangeRequest,
  git: GitRunner,
): Promise<{ base: string; head: string; baseSha: string; headSha: string }> {
  switch (request.mode) {
    case "range": {
      if (!request.base || !request.head) throw new GitError("El modo range necesita base y head.");
      return {
        base: request.base,
        head: request.head,
        baseSha: await resolveCommit(repoRoot, request.base, git),
        headSha: await resolveCommit(repoRoot, request.head, git),
      };
    }
    case "commit": {
      const head = request.head ?? "HEAD";
      const headSha = await resolveCommit(repoRoot, head, git);
      const parents = (await git(["rev-list", "--parents", "-n", "1", headSha], repoRoot)).trim().split(/\s+/);
      const parent = parents[1];
      return { base: parent ? `${head}~1` : "(árbol vacío)", head, baseSha: parent ?? (await emptyTree(repoRoot, git)), headSha };
    }
    case "branch": {
      if (!request.base) throw new GitError("El modo branch necesita una base (p. ej. main).");
      const head = request.head ?? "HEAD";
      const headSha = await resolveCommit(repoRoot, head, git);
      const target = await resolveCommit(repoRoot, request.base, git);
      const mergeBase = (await git(["merge-base", target, headSha], repoRoot)).trim();
      return { base: request.base, head, baseSha: mergeBase, headSha };
    }
    case "worktree": {
      const base = request.base ?? "HEAD";
      const baseSha = base === "HEAD" && !(await hasHead(repoRoot, git)) ? await emptyTree(repoRoot, git) : await resolveCommit(repoRoot, base, git);
      return { base, head: WORKTREE_REF, baseSha, headSha: WORKTREE_REF };
    }
  }
}

function diffArgs(baseSha: string, headSha: string): string[] {
  return [
    "-c",
    "core.quotepath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-U0",
    "-M",
    "--full-index",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    baseSha,
    ...(headSha === WORKTREE_REF ? [] : [headSha]),
    "--",
  ];
}

/** Cambios con hunks para los cuatro modos. En `worktree` incluye los archivos sin seguimiento como añadidos. */
export async function collectChanges(directory: string, request: ChangeRequest, git: GitRunner = runGit): Promise<ChangeSet> {
  const repoRoot = await repoToplevel(directory, git);
  const endpoints = await resolveEndpoints(repoRoot, request, git);
  const warnings: string[] = [];
  const stdout = await git(diffArgs(endpoints.baseSha, endpoints.headSha), repoRoot);
  let patches = parseUnifiedDiff(stdout).filter((patch) => !isAuditorArtifact(patch.path));

  if (endpoints.headSha === WORKTREE_REF) {
    const untracked = (await git(["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z"], repoRoot))
      .split("\0")
      .filter((name) => name.length > 0 && !isAuditorArtifact(name));
    patches = patches.concat(await untrackedPatches(repoRoot, untracked, git, warnings));
  }

  if (patches.length > MAX_FILES) {
    warnings.push(`Diff con ${patches.length} archivos: se auditan los primeros ${MAX_FILES}.`);
    patches = patches.slice(0, MAX_FILES);
  }
  return { repoRoot, mode: request.mode, ...endpoints, patches, warnings };
}

async function untrackedPatches(repoRoot: string, files: readonly string[], git: GitRunner, warnings: string[]): Promise<FilePatch[]> {
  if (files.length === 0) return [];
  const blobs = (await git(["hash-object", "--stdin-paths"], repoRoot, `${files.join("\n")}\n`)).trim().split("\n");
  const patches: FilePatch[] = [];
  for (const [index, file] of files.entries()) {
    const absolute = path.join(repoRoot, file);
    const patch: FilePatch = { path: file, status: "added", binary: false, untracked: true, newBlob: blobs[index]?.trim(), hunks: [] };
    try {
      const info = await stat(absolute);
      if (info.size > MAX_UNTRACKED_BYTES) {
        warnings.push(`${file}: sin seguimiento y demasiado grande (${info.size} bytes), solo se analiza la ruta.`);
        patch.binary = true;
        patches.push(patch);
        continue;
      }
      const text = await readFile(absolute, "utf8");
      if (text.includes("\0")) {
        patch.binary = true;
        patches.push(patch);
        continue;
      }
      const lines = splitLines(text);
      const diffLines: DiffLine[] = lines.map((value, offset) => ({ kind: "add", line: offset + 1, text: value }));
      if (diffLines.length > 0) {
        patch.hunks.push({
          header: `@@ -0,0 +1,${diffLines.length} @@`,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: diffLines.length,
          lines: diffLines,
        });
      }
      patches.push(patch);
    } catch {
      warnings.push(`${file}: no se pudo leer.`);
    }
  }
  return patches;
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Contenido de un archivo en un lado del diff. Head del árbol de trabajo → disco (con la ruta confinada al repo);
 * resto → `git cat-file` por blob, o `git show <sha>:<ruta>` si no hay blob. `null` si no existe o es binario.
 */
export async function readVersion(
  repoRoot: string,
  commit: string,
  file: string,
  blob: string | undefined,
  git: GitRunner = runGit,
): Promise<string | null> {
  try {
    let text: string;
    if (commit === WORKTREE_REF) {
      const absolute = path.resolve(repoRoot, file);
      const relative = path.relative(repoRoot, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
      text = await readFile(absolute, "utf8");
    } else if (blob && /^[0-9a-f]{40,64}$/.test(blob)) {
      text = await git(["cat-file", "blob", blob], repoRoot);
    } else {
      if (!/^[0-9a-f]{40,64}$/.test(commit)) return null;
      text = await git(["show", `${commit}:${file}`], repoRoot);
    }
    return text.includes("\0") ? null : text.replace(/^﻿/, "");
  } catch {
    return null;
  }
}
