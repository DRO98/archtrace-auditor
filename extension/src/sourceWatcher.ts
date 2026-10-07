import * as vscode from "vscode";
import type { SourceFilesChangedMessage } from "@core/protocol";
import { SOURCE_GLOB, SourceChangeBatcher, toWorkspaceSourcePath } from "./sourceChanges.js";

/**
 * Vigila los archivos fuente del workspace con la API nativa de VS Code (sin chokidar)
 * y avisa al canvas con `SOURCE_FILES_CHANGED` cuando se crean, modifican o borran.
 */
export class SourceWatcher {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly batcher: SourceChangeBatcher;

  constructor(emit: (message: SourceFilesChangedMessage) => void) {
    this.batcher = new SourceChangeBatcher((batch) => {
      emit({ protocol: "TEACHER_CANVAS_v1", action: "SOURCE_FILES_CHANGED", payload: batch });
    });
    this.watcher = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    const onChange = (uri: vscode.Uri): void => this.record(uri);
    this.subscriptions.push(
      this.watcher,
      this.watcher.onDidCreate(onChange),
      this.watcher.onDidChange(onChange),
      this.watcher.onDidDelete(onChange),
    );
  }

  dispose(): void {
    this.batcher.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  private record(uri: vscode.Uri): void {
    if (uri.scheme !== "file") return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const relative = toWorkspaceSourcePath(folder.uri.fsPath, uri.fsPath);
    if (relative) this.batcher.add(relative);
  }
}
