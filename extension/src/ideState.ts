import path from "node:path";
import * as vscode from "vscode";
import type { IdeStateChangedMessage } from "@core/protocol";
import { resolveInsideWorkspace, toProtocolLine } from "./pathGuard.js";

const CURSOR_DEBOUNCE_MS = 50;

export class IdeStateEmitter {
  private readonly subscriptions: vscode.Disposable[] = [];
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;
  private lastKey: string | undefined;

  constructor(private readonly emit: (message: IdeStateChangedMessage) => void) {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.publish();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.scheduleCursor();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.publish();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document === vscode.window.activeTextEditor?.document) {
          this.publish();
        }
      }),
    );
  }

  snapshot(): IdeStateChangedMessage | null {
    const message = this.readState();
    this.lastKey = message ? stateKey(message) : undefined;
    return message;
  }

  dispose(): void {
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = undefined;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
  }

  private scheduleCursor(): void {
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer);
    }
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = undefined;
      this.publish();
    }, CURSOR_DEBOUNCE_MS);
  }

  private publish(): void {
    const message = this.readState();
    const key = message ? stateKey(message) : undefined;
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    if (message) {
      this.emit(message);
    }
  }

  private readState(): IdeStateChangedMessage | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const document = editor.document;
    if (document.uri.scheme !== "file") {
      return null;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return null;
    }

    const absolute = resolveInsideWorkspace(folder.uri.fsPath, document.uri.fsPath);
    if (!absolute) {
      return null;
    }

    const activeFile = path
      .relative(path.resolve(folder.uri.fsPath), absolute)
      .split(path.sep)
      .join("/");

    return {
      protocol: "TEACHER_CANVAS_v1",
      action: "IDE_STATE_CHANGED",
      payload: {
        activeFile,
        cursorLine: toProtocolLine(editor.selection.active.line),
        status: document.isDirty ? "dirty" : "clean",
      },
    };
  }
}

function stateKey(message: IdeStateChangedMessage): string {
  return JSON.stringify(message.payload);
}
