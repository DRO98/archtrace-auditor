import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

/** Raíz de los datos del auditor fuera de cualquier repo (`ARCHTRACE_HOME` para tests o instalaciones portables). */
export function archtraceHome(): string {
  return process.env.ARCHTRACE_HOME?.trim() || path.join(os.homedir(), ".archtrace");
}

/** Clave estable de un repo a partir de su raíz (sin distinguir mayúsculas en Windows). */
export function repoKey(repoRoot: string): string {
  const normalized = path.resolve(repoRoot);
  const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function repoDataDir(repoRoot: string, home = archtraceHome()): string {
  return path.join(home, "index", repoKey(repoRoot));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Ruta relativa al repo en formato POSIX. */
export function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}
