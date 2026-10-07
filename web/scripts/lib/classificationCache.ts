import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AiClassification } from "./aiClassifier";

/** Súbelo si cambian el prompt o las capas: invalida todas las entradas previas. */
export const CACHE_VERSION = 1;

export interface CachedClassification extends AiClassification {
  /** Solo informativo: la clave es el hash del contenido. */
  path: string;
  model: string;
  classifiedAt: string;
}

interface CacheFile {
  version: number;
  entries: Record<string, CachedClassification>;
}

export function contentHash(source: string): string {
  return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

/** Caché local de clasificaciones IA indexada por hash del contenido del archivo. */
export class ClassificationCache {
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly entries: Map<string, CachedClassification>,
  ) {}

  static load(file: string): ClassificationCache {
    const entries = new Map<string, CachedClassification>();
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheFile>;
        if (parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === "object") {
          for (const [hash, entry] of Object.entries(parsed.entries)) entries.set(hash, entry);
        }
      } catch {
        console.warn(`[classify] caché ilegible, se ignora: ${file}`);
      }
    }
    return new ClassificationCache(file, entries);
  }

  get(hash: string): CachedClassification | undefined {
    return this.entries.get(hash);
  }

  set(hash: string, entry: CachedClassification): void {
    this.entries.set(hash, entry);
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const sorted = Object.fromEntries([...this.entries].sort(([left], [right]) => left.localeCompare(right)));
    const body: CacheFile = { version: CACHE_VERSION, entries: sorted };
    writeFileSync(this.file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    this.dirty = false;
  }
}
