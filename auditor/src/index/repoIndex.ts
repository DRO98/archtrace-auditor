import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { MapLanguage, MapSymbolKind } from "@core/projectMap";
import type { LineRange } from "@core/protocol";
import { selectTopSources } from "@core/rankSources";
import { createParserHost, grammarFor, type ParserHost } from "@scanner/parserHost";
import { prepareWasmDir } from "@scanner/wasm";
import { isRuleDocument, sectionize, type DocSection } from "../docs/sections";
import { isAuditorArtifact } from "../git/changes";
import { runGit, type GitRunner } from "../git/run";
import { archtraceHome, repoDataDir } from "../paths";

export interface SymbolSummary {
  name: string;
  qualifiedName: string;
  parentQualifiedName?: string;
  kind: MapSymbolKind;
  range: LineRange;
  signature: string;
  doc?: string;
}

/** Lo que se guarda por blob de código: suficiente para hunk → símbolo y para el contexto L1–L3. */
export interface BlobEntry {
  language: MapLanguage;
  lineCount: number;
  imports: string[];
  symbols: SymbolSummary[];
  calls: Array<{ name: string; line: number; enclosing: string | null }>;
  lastUsed: string;
}

interface DocEntry {
  file: string;
  sections: DocSection[];
  lastUsed: string;
}

interface IndexFile {
  version: 1;
  repoRoot: string;
  updatedAt: string;
  /** Árbol de trabajo en el último `refresh`: ruta → blob SHA (solo código indexable y documentos de reglas). */
  tree: Record<string, string>;
  blobs: Record<string, BlobEntry>;
  docs: Record<string, DocEntry>;
}

export interface IndexStats {
  blobsParsed: number;
  blobsReused: number;
  docsParsed: number;
  docsReused: number;
}

export interface RepoIndexOptions {
  home?: string;
  maxFiles?: number;
  maxFileBytes?: number;
}

const INDEX_VERSION = 1;
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const EXCLUDED_DIR = /(^|\/)(node_modules|dist|build|out|\.next|vendor|__pycache__|\.venv|venv|coverage|\.git)\//;
const EXCLUDED_FILE = /(\.min\.js|\.d\.ts)$/;

/**
 * Índice incremental del repo, fuera del repo (`~/.archtrace/index/<hashRepo>/index.json`). Todo se indexa por
 * blob SHA: un blob ya parseado no se vuelve a parsear, venga del árbol de trabajo, de la base o de la cabeza.
 */
export class RepoIndex {
  readonly stats: IndexStats = { blobsParsed: 0, blobsReused: 0, docsParsed: 0, docsReused: 0 };
  private host: ParserHost | null = null;
  private readonly file: string;

  private constructor(
    readonly repoRoot: string,
    readonly dataDir: string,
    private readonly data: IndexFile,
    private readonly options: Required<Omit<RepoIndexOptions, "home">> & { home: string },
  ) {
    this.file = path.join(dataDir, "index.json");
  }

  static load(repoRoot: string, options: RepoIndexOptions = {}): RepoIndex {
    const home = options.home ?? archtraceHome();
    const dataDir = repoDataDir(repoRoot, home);
    const file = path.join(dataDir, "index.json");
    let data: IndexFile = { version: INDEX_VERSION, repoRoot, updatedAt: "", tree: {}, blobs: {}, docs: {} };
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as IndexFile;
        if (parsed.version === INDEX_VERSION) data = parsed;
      } catch {
        // Índice corrupto: se reconstruye.
      }
    }
    return new RepoIndex(repoRoot, dataDir, data, {
      home,
      maxFiles: options.maxFiles ?? 3000,
      maxFileBytes: options.maxFileBytes ?? 512 * 1024,
    });
  }

  /** Blob de código ya indexado o parseado ahora. `null` si no hay gramática o no se pudo leer. */
  async ensureBlob(sha: string | undefined, file: string, loadText: () => Promise<string | null>): Promise<BlobEntry | null> {
    const kind = grammarFor(file);
    if (!kind) return null;
    const now = new Date().toISOString();
    if (sha) {
      const cached = this.data.blobs[sha];
      if (cached) {
        cached.lastUsed = now;
        this.stats.blobsReused += 1;
        return cached;
      }
    }
    const text = await loadText();
    if (text === null || Buffer.byteLength(text) > this.options.maxFileBytes) return null;
    try {
      const host = await this.parser();
      const raw = await host.parse(kind.language, file, text);
      const entry: BlobEntry = {
        language: raw.language,
        lineCount: raw.lineCount,
        imports: raw.imports.map((item) => (item.level > 0 ? `${".".repeat(item.level)}${item.specifier}` : item.specifier)),
        symbols: raw.symbols.map((symbol) => ({
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          ...(symbol.parentQualifiedName ? { parentQualifiedName: symbol.parentQualifiedName } : {}),
          kind: symbol.kind,
          range: symbol.range,
          signature: symbol.signature,
          ...(symbol.doc ? { doc: symbol.doc } : {}),
        })),
        calls: raw.callSites.map((call) => ({ name: call.name, line: call.range.startLine, enclosing: call.enclosing })),
        lastUsed: now,
      };
      this.stats.blobsParsed += 1;
      if (sha) this.data.blobs[sha] = entry;
      return entry;
    } catch {
      return null;
    }
  }

  async ensureDoc(sha: string, file: string, loadText: () => Promise<string | null>): Promise<DocSection[]> {
    const now = new Date().toISOString();
    const cached = this.data.docs[sha];
    if (cached && cached.file === file) {
      cached.lastUsed = now;
      this.stats.docsReused += 1;
      return cached.sections;
    }
    const text = await loadText();
    if (text === null) return [];
    const sections = sectionize(file, text);
    this.data.docs[sha] = { file, sections, lastUsed: now };
    this.stats.docsParsed += 1;
    return sections;
  }

  /**
   * Sincroniza con el árbol de trabajo: blob SHA de lo versionado (`ls-files -s`), y `hash-object` solo para lo
   * modificado o sin seguimiento. Únicamente se parsean blobs nuevos.
   */
  async refresh(git: GitRunner = runGit): Promise<IndexStats> {
    const root = this.repoRoot;
    const tree = new Map<string, string>();
    for (const record of (await git(["ls-files", "-s", "-z"], root)).split("\0")) {
      const match = /^\d+ ([0-9a-f]{40,64}) 0\t(.+)$/.exec(record);
      if (match) tree.set(match[2]!, match[1]!);
    }
    for (const deleted of splitZ(await git(["ls-files", "-d", "-z"], root))) tree.delete(deleted);
    const dirty = [...new Set([...splitZ(await git(["ls-files", "-m", "-z"], root)), ...splitZ(await git(["ls-files", "--others", "--exclude-standard", "-z"], root))])]
      .filter((file) => isIndexable(file) || isRuleDocument(file))
      .filter((file) => existsSync(path.join(root, file)));
    if (dirty.length > 0) {
      const hashes = (await git(["hash-object", "--stdin-paths"], root, `${dirty.join("\n")}\n`)).trim().split("\n");
      dirty.forEach((file, index) => {
        const sha = hashes[index]?.trim();
        if (sha) tree.set(file, sha);
      });
    }

    const docs = [...tree.keys()].filter((file) => isRuleDocument(file) && !isAuditorArtifact(file));
    const sources = selectTopSources(
      [...tree.keys()].filter(isIndexable).map((file) => ({ path: file })),
      this.options.maxFiles,
    ).selected.map((item) => item.path);

    const nextTree: Record<string, string> = {};
    for (const file of docs) {
      const sha = tree.get(file)!;
      nextTree[file] = sha;
      await this.ensureDoc(sha, file, () => this.readDisk(file));
    }
    for (const file of sources) {
      const sha = tree.get(file)!;
      nextTree[file] = sha;
      await this.ensureBlob(sha, file, () => this.readDisk(file));
    }
    this.data.tree = nextTree;
    this.data.updatedAt = new Date().toISOString();
    return { ...this.stats };
  }

  /** Secciones de los documentos de reglas del árbol de trabajo actual. */
  docSections(): DocSection[] {
    const sections: DocSection[] = [];
    for (const [file, sha] of Object.entries(this.data.tree)) {
      if (!isRuleDocument(file)) continue;
      const entry = this.data.docs[sha];
      if (entry) sections.push(...entry.sections);
    }
    return sections.sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Blob indexado del árbol de trabajo para una ruta (contexto L3, búsqueda de símbolos fuera del diff). */
  treeEntry(file: string): BlobEntry | null {
    const sha = this.data.tree[file];
    return sha ? (this.data.blobs[sha] ?? null) : null;
  }

  treeFiles(): string[] {
    return Object.keys(this.data.tree);
  }

  save(): void {
    this.prune();
    mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.data), "utf8");
    renameSync(temporary, this.file);
  }

  dispose(): void {
    this.host?.dispose();
    this.host = null;
  }

  private async parser(): Promise<ParserHost> {
    if (!this.host) this.host = await createParserHost(prepareWasmDir(path.join(this.options.home, "wasm")));
    return this.host;
  }

  private async readDisk(file: string): Promise<string | null> {
    try {
      const absolute = path.join(this.repoRoot, file);
      if ((await stat(absolute)).size > this.options.maxFileBytes) return null;
      const text = await readFile(absolute, "utf8");
      return text.includes("\0") ? null : text.replace(/^﻿/, "");
    } catch {
      return null;
    }
  }

  /** Blobs sin uso en 30 días y fuera del árbol actual. */
  private prune(): void {
    const live = new Set(Object.values(this.data.tree));
    const limit = Date.now() - PRUNE_AFTER_MS;
    for (const store of [this.data.blobs, this.data.docs] as Array<Record<string, { lastUsed: string }>>) {
      for (const [sha, entry] of Object.entries(store)) {
        if (!live.has(sha) && Date.parse(entry.lastUsed) < limit) delete store[sha];
      }
    }
  }
}

function splitZ(stdout: string): string[] {
  return stdout.split("\0").filter((item) => item.length > 0);
}

function isIndexable(file: string): boolean {
  return grammarFor(file) !== null && !EXCLUDED_DIR.test(file) && !EXCLUDED_FILE.test(file);
}
