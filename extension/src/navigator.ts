import path from "node:path";
import * as vscode from "vscode";
import type { NavigateToCodePayload } from "@core/protocol";
import { resolveExistingInsideWorkspace, resolveHighlightColor, toZeroBasedLine } from "./pathGuard.js";

const MAX_DECORATIONS = 16;
const MAX_RESOLVED = 500;

export class CodeNavigator {
  private readonly decorations = new Map<string, vscode.TextEditorDecorationType>();
  private readonly resolvedPaths = new Map<string, string>();
  private active:
    | { editor: vscode.TextEditor; decoration: vscode.TextEditorDecorationType }
    | undefined;

  constructor(private readonly log: (line: string) => void) {}

  async navigate(payload: NavigateToCodePayload): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.log("No workspace folder is open.");
      return;
    }

    const resolved = await this.resolve(folders, payload.filePath);
    if (!resolved) {
      this.log(`Rejected path outside workspace or missing: ${payload.filePath}`);
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      if (document.lineCount < 1) {
        this.log(`Could not highlight ${payload.filePath}: document has no lines.`);
        return;
      }

      const editor = await vscode.window.showTextDocument(document, {
        preserveFocus: !(payload.focusEditor ?? true),
        preview: false,
      });

      const { startLine, endLine } = payload.range;
      if (endLine > document.lineCount) {
        this.log(
          `Range L${startLine}-${endLine} exceeds ${payload.filePath} (${document.lineCount} lines); clamping. The graph may be stale.`,
        );
      }

      const start = toZeroBasedLine(startLine, document.lineCount);
      const end = toZeroBasedLine(endLine, document.lineCount);
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const range = new vscode.Range(from, 0, to, document.lineAt(to).text.length);
      const decoration = this.decorationFor(resolveHighlightColor(payload.highlightColor));

      this.clear();
      editor.setDecorations(decoration, [range]);
      this.active = { editor, decoration };
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`Could not open ${payload.filePath}: ${detail}`);
    }
  }

  /**
   * The graph's paths are relative to the analysed project, which may be a
   * subfolder of the open workspace (e.g. `sandbox/`). Try each workspace root
   * first, then look for a unique-enough suffix match; every candidate still
   * goes through the workspace guard.
   */
  private async resolve(folders: readonly vscode.WorkspaceFolder[], filePath: string): Promise<string | null> {
    const cached = this.resolvedPaths.get(filePath);
    if (cached) return cached;

    for (const folder of folders) {
      const direct = resolveExistingInsideWorkspace(folder.uri.fsPath, filePath);
      if (direct) return this.remember(filePath, direct);
    }

    const relative = filePath.replace(/\\/g, "/");
    if (relative.startsWith("/") || relative.split("/").includes("..")) return null;
    const matches = await vscode.workspace.findFiles(`**/${relative}`, "**/{node_modules,.git,.next,dist}/**", 5);
    const guarded = matches
      .map((uri) => {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) return null;
        const inside = path.relative(folder.uri.fsPath, uri.fsPath);
        return resolveExistingInsideWorkspace(folder.uri.fsPath, inside);
      })
      .filter((candidate): candidate is string => candidate !== null)
      .sort((left, right) => left.length - right.length);
    const best = guarded[0];
    if (!best) return null;
    if (guarded.length > 1) this.log(`Several files match ${filePath}; opening ${best}.`);
    return this.remember(filePath, best);
  }

  private remember(filePath: string, resolved: string): string {
    if (this.resolvedPaths.size >= MAX_RESOLVED) this.resolvedPaths.clear();
    this.resolvedPaths.set(filePath, resolved);
    return resolved;
  }

  clear(): void {
    if (!this.active) {
      return;
    }
    const { editor, decoration } = this.active;
    this.active = undefined;
    editor.setDecorations(decoration, []);
  }

  dispose(): void {
    this.clear();
    for (const decoration of this.decorations.values()) {
      decoration.dispose();
    }
    this.decorations.clear();
  }

  private decorationFor(color: string): vscode.TextEditorDecorationType {
    const cached = this.decorations.get(color);
    if (cached) {
      // Refresh insertion order so the Map behaves as an LRU.
      this.decorations.delete(color);
      this.decorations.set(color, cached);
      return cached;
    }
    if (this.decorations.size >= MAX_DECORATIONS) {
      this.evictOldest();
    }
    const created = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color,
    });
    this.decorations.set(color, created);
    return created;
  }

  private evictOldest(): void {
    for (const [color, decoration] of this.decorations) {
      if (this.active?.decoration === decoration) {
        continue;
      }
      this.decorations.delete(color);
      decoration.dispose();
      return;
    }
  }
}
