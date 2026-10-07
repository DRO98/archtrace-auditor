import path from "node:path";
import * as vscode from "vscode";
import type { ProjectMap } from "@core/projectMap";
import { selectTopSources } from "@core/rankSources";
import { readSetting } from "../settings.js";
import { grammarFor, createParserHost, type ParserHost } from "./parserHost.js";
import { buildProjectMap } from "./resolve.js";
import type { RawFile } from "./types.js";

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/tests/**",
  "**/test_*.py",
];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function setting<T>(key: string, fallback: T): T {
  return readSetting(key, fallback);
}

export class ProjectScanner implements vscode.Disposable {
  private host: ParserHost | null = null;
  private inflight: Promise<ProjectMap> | null = null;
  private readonly cache = new Map<string, { key: string; raw: RawFile }>();

  constructor(private readonly wasmDir: string) {}

  scan(): Promise<ProjectMap> {
    if (this.inflight) return this.inflight;
    const run = this.run();
    this.inflight = run;
    return run.finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
  }

  dispose(): void {
    this.host?.dispose();
    this.host = null;
  }

  private async ensureHost(): Promise<ParserHost> {
    if (!this.host) this.host = await createParserHost(this.wasmDir);
    return this.host;
  }

  private async run(): Promise<ProjectMap> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error("No hay una carpeta de workspace abierta.");
    const root = folder.uri.fsPath;
    const maxFiles = setting("archtrace.scan.maxFiles", 400);
    const maxFileBytes = setting("archtrace.scan.maxFileBytes", 524288);
    const exclude = setting("archtrace.scan.exclude", DEFAULT_EXCLUDE);
    const pattern = new vscode.RelativePattern(folder, "**/*.{py,ts,tsx,js,jsx,mjs,cjs}");
    const uris = await vscode.workspace.findFiles(pattern, `{${exclude.join(",")}}`);
    // Si sobran archivos, entran los mejor puntuados (entrypoints, `src/`, reparto entre paquetes), no los primeros por orden alfabético.
    const truncated = uris.length > maxFiles;
    const selected = selectTopSources(
      uris.map((uri) => ({ path: toPosix(path.relative(root, uri.fsPath)), uri })),
      maxFiles,
    ).selected.map((candidate) => candidate.uri);
    const host = await this.ensureHost();
    const files: Array<{ filePath: string; raw: RawFile }> = [];
    let skippedFiles = 0;

    for (let index = 0; index < selected.length; index += 1) {
      const uri = selected[index];
      if (!uri) continue;
      const relative = toPosix(path.relative(root, uri.fsPath));
      const kind = grammarFor(relative);
      if (!kind) continue;
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      try {
        let text = "";
        let key = "";
        if (open && open.isDirty) {
          text = open.getText();
          key = `open:${open.version}`;
        } else {
          const stat = await vscode.workspace.fs.stat(uri);
          key = `${stat.mtime}:${stat.size}`;
          if (stat.size > maxFileBytes) {
            skippedFiles += 1;
            continue;
          }
          const cached = this.cache.get(relative);
          if (cached && cached.key === key) {
            files.push({ filePath: relative, raw: cached.raw });
            continue;
          }
          const bytes = await vscode.workspace.fs.readFile(uri);
          text = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
        }
        if (text.includes("\0") || Buffer.byteLength(text) > maxFileBytes) {
          skippedFiles += 1;
          continue;
        }
        const raw = await host.parse(kind.language, relative, text);
        this.cache.set(relative, { key, raw });
        files.push({ filePath: relative, raw });
      } catch {
        skippedFiles += 1;
      }
      if ((index + 1) % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return buildProjectMap(files, {
      workspaceName: folder.name,
      generatedAt: new Date().toISOString(),
      truncated,
      skippedFiles,
    });
  }
}
