import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TokenUsage } from "@core/playground";
import { sha256 } from "../paths";

interface CacheEntry {
  value: unknown;
  usage?: TokenUsage;
  createdAt: string;
}

const MAX_ENTRIES = 5000;

/**
 * Caché de respuestas del LLM por hash(unidad + nivel + contexto + proveedor + modelo + versión del prompt).
 * Vive junto al índice, fuera del repo. Solo guarda la salida estructurada, nunca la clave.
 */
export class LlmCache {
  private readonly entries: Record<string, CacheEntry>;
  private dirty = false;

  constructor(private readonly file: string | null) {
    this.entries = {};
    if (file && existsSync(file)) {
      try {
        Object.assign(this.entries, JSON.parse(readFileSync(file, "utf8")) as Record<string, CacheEntry>);
      } catch {
        // Caché dañada: se empieza de cero.
      }
    }
  }

  static inDir(directory: string): LlmCache {
    return new LlmCache(path.join(directory, "llm-cache.json"));
  }

  static key(parts: { promptVersion: string; provider: string; model: string; unitId: string; level: number; context: string }): string {
    return sha256([parts.promptVersion, parts.provider, parts.model, parts.unitId, String(parts.level), sha256(parts.context)].join("|"));
  }

  get(key: string): CacheEntry | null {
    return this.entries[key] ?? null;
  }

  set(key: string, value: unknown, usage?: TokenUsage): void {
    this.entries[key] = { value, ...(usage ? { usage } : {}), createdAt: new Date().toISOString() };
    this.dirty = true;
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    const keys = Object.keys(this.entries);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((left, right) => this.entries[left]!.createdAt.localeCompare(this.entries[right]!.createdAt))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete this.entries[key]);
    }
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.entries), "utf8");
    renameSync(temporary, this.file);
    this.dirty = false;
  }
}
