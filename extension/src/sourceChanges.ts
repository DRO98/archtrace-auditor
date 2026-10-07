import path from "node:path";
import { resolveInsideWorkspace } from "./pathGuard.js";

export const SOURCE_GLOB = "**/src/**/*.{py,js,jsx,ts,tsx,mjs,cjs}";
export const SOURCE_DEBOUNCE_MS = 400;
export const MAX_CHANGED_PATHS = 200;

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
]);

/**
 * Ruta relativa POSIX de un archivo fuente del workspace, o `null` si está fuera de él
 * o dentro de una carpeta generada (node_modules, dist…). No exige que el archivo exista:
 * un borrado también es un cambio.
 */
export function toWorkspaceSourcePath(root: string, fsPath: string): string | null {
  const absolute = resolveInsideWorkspace(root, fsPath);
  if (!absolute) return null;
  const relative = path.relative(path.resolve(root), absolute).split(path.sep).join("/");
  if (relative.length === 0) return null;
  if (relative.split("/").some((segment) => IGNORED_SEGMENTS.has(segment))) return null;
  return relative;
}

export interface SourceChangeBatch {
  changedPaths: string[];
  changedAt: string;
}

/** Agrupa cambios en ráfaga: emite un lote deduplicado cuando pasan `delayMs` sin cambios nuevos. */
export class SourceChangeBatcher {
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastChange = 0;

  constructor(
    private readonly emit: (batch: SourceChangeBatch) => void,
    private readonly delayMs = SOURCE_DEBOUNCE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  add(relativePath: string): void {
    this.pending.add(relativePath);
    this.lastChange = this.now();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending.size === 0) return;
    const changedPaths = [...this.pending].sort().slice(0, MAX_CHANGED_PATHS);
    this.pending.clear();
    this.emit({ changedPaths, changedAt: new Date(this.lastChange).toISOString() });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }
}
