import { execFile } from "node:child_process";

/**
 * Mismo guardarraíl que `extension/src/gitDiff.ts`: siempre `execFile` con argumentos (sin shell), refs validados
 * con `isSafeRef` (`@core/gitRef`) y `--` antes de rutas. El auditor necesita más margen (parches completos,
 * `cat-file` de archivos grandes), por eso el plazo y el buffer son configurables.
 */
export type GitRunner = (args: readonly string[], cwd: string, input?: string) => Promise<string>;

export interface GitRunnerOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const timeout = options.timeoutMs ?? 30_000;
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  return (args, cwd, input) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        [...args],
        {
          cwd,
          timeout,
          maxBuffer,
          windowsHide: true,
          encoding: "utf8",
          // Sin prompts de credenciales ni paginador; salida estable.
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C" },
        },
        (error, stdout, stderr) => {
          if (error) reject(new Error(String(stderr).trim() || error.message));
          else resolve(String(stdout));
        },
      );
      if (input !== undefined) child.stdin?.end(input);
    });
}

export const runGit: GitRunner = createGitRunner();

/** Árbol vacío de git: base de un commit raíz o de un repo sin commits. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
