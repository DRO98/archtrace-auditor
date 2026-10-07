import * as vscode from "vscode";
import path from "node:path";
import { readServerConfig } from "./config.js";
import { affectsSettings, readSetting } from "./settings.js";
import type { LocalServicesDiscoveredMessage } from "@core/protocol";
import { IdeStateEmitter } from "./ideState.js";
import { discoverLocalServices } from "./localServices.js";
import { gitDiff, gitRefs } from "./gitDiff.js";
import { CodeNavigator } from "./navigator.js";
import { ProjectScanner } from "./scan/scanner.js";
import { BridgeServer } from "./server.js";
import { SourceWatcher } from "./sourceWatcher.js";

let output: vscode.OutputChannel | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let server: BridgeServer | undefined;
let navigator: CodeNavigator | undefined;
let ideState: IdeStateEmitter | undefined;
let scanner: ProjectScanner | undefined;
let sourceWatcher: SourceWatcher | undefined;
let host = "127.0.0.1";
let port = 8080;
let restarting: Promise<void> = Promise.resolve();
/** Último descubrimiento de servicios locales: se reenvía a cada lienzo que se conecta. */
let lastServices: LocalServicesDiscoveredMessage | undefined;

async function discoverServices(requestId: string | null): Promise<LocalServicesDiscoveredMessage> {
  const result = await discoverLocalServices({ ownPort: port });
  const message: LocalServicesDiscoveredMessage = {
    protocol: "TEACHER_CANVAS_v1",
    action: "LOCAL_SERVICES_DISCOVERED",
    payload: { requestId, ...result },
  };
  lastServices = { ...message, payload: { ...message.payload, requestId: null } };
  output?.appendLine(`Local services: ${result.services.map((item) => `${item.label}:${item.port}`).join(", ") || "ninguno"}`);
  return message;
}

function getConfig<T>(key: string, defaultValue: T): T {
  return readSetting(key, defaultValue);
}

function errorCode(error: Error): string | undefined {
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function renderStatus(): void {
  if (!statusItem) {
    return;
  }
  const clients = server?.clientCount ?? 0;
  statusItem.text = `$(broadcast) ArchTrace :${port} · ${clients}`;
  statusItem.tooltip = `${host}:${port} · ${clients} client(s)`;
}

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function boot(): void {
  const config = readServerConfig(getConfig);
  host = config.host;
  port = config.port;
  for (const warning of config.warnings) {
    output?.appendLine(warning);
    void vscode.window.showWarningMessage(`ArchTrace: ${warning}`);
  }

  const next = new BridgeServer({
    host: config.host,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    log: (line) => output?.appendLine(line),
    onClientsChanged: () => renderStatus(),
    onError: (error) => {
      if (errorCode(error) === "EADDRINUSE") {
        void vscode.window.showErrorMessage(
          `ArchTrace: ${host}:${port} is already in use.`,
        );
        return;
      }
      void vscode.window.showErrorMessage(`ArchTrace: ${error.message}`);
    },
  });

  next.onMessage((message, reply) => {
    switch (message.action) {
      case "NAVIGATE_TO_CODE":
        void navigator?.navigate(message.payload);
        return;
      case "CLEAR_HIGHLIGHTS":
        navigator?.clear();
        return;
      case "REQUEST_PROJECT_MAP":
        void scanner
          ?.scan()
          .then((map) => {
            reply({
              protocol: "TEACHER_CANVAS_v1",
              action: "PROJECT_MAP",
              payload: { requestId: message.payload.requestId, map },
            });
          })
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : "No se pudo indexar el workspace.";
            reply({
              protocol: "TEACHER_CANVAS_v1",
              action: "PROJECT_MAP_ERROR",
              payload: { requestId: message.payload.requestId, message: detail },
            });
          });
        return;
      case "REQUEST_GIT_REFS": {
        const root = workspaceRoot();
        const { requestId } = message.payload;
        if (!root) {
          reply({ protocol: "TEACHER_CANVAS_v1", action: "GIT_REFS", payload: { requestId, current: null, branches: [], commits: [], error: "No hay carpeta abierta en el IDE." } });
          return;
        }
        void gitRefs(root).then((refs) => reply({ protocol: "TEACHER_CANVAS_v1", action: "GIT_REFS", payload: { requestId, ...refs } }));
        return;
      }
      case "REQUEST_GIT_DIFF": {
        const root = workspaceRoot();
        const { requestId, base, head } = message.payload;
        if (!root) {
          reply({ protocol: "TEACHER_CANVAS_v1", action: "GIT_DIFF", payload: { requestId, base, head, files: [], error: "No hay carpeta abierta en el IDE." } });
          return;
        }
        void gitDiff(root, base, head).then((diff) => reply({ protocol: "TEACHER_CANVAS_v1", action: "GIT_DIFF", payload: { requestId, ...diff } }));
        return;
      }
      case "REQUEST_LOCAL_SERVICES":
        void discoverServices(message.payload.requestId).then(reply);
        return;
      default:
        return;
    }
  });

  next.onConnection((send) => {
    const snapshot = ideState?.snapshot();
    if (snapshot) {
      send(snapshot);
    }
    if (lastServices) {
      send(lastServices);
    }
  });

  server = next;
  renderStatus();

  try {
    next.start();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    output?.appendLine(`Server error: ${detail}`);
    void vscode.window.showErrorMessage(`ArchTrace: ${detail}`);
  }
}

async function restart(): Promise<void> {
  await server?.stop();
  server = undefined;
  boot();
  output?.appendLine("Server restarted");
}

function scheduleRestart(): void {
  restarting = restarting
    .then(() => restart())
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      output?.appendLine(`Restart failed: ${detail}`);
    });
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("ArchTrace");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "archtrace.showStatus";
  statusItem.show();

  navigator = new CodeNavigator((line) => output?.appendLine(line));
  ideState = new IdeStateEmitter((message) => {
    server?.broadcast(message);
  });
  scanner = new ProjectScanner(path.join(__dirname, "wasm"));
  sourceWatcher = new SourceWatcher((message) => {
    output?.appendLine(`Source changed: ${message.payload.changedPaths.join(", ")}`);
    server?.broadcast(message);
  });
  context.subscriptions.push(output, statusItem, navigator, ideState, scanner, sourceWatcher);

  boot();

  context.subscriptions.push(
    vscode.commands.registerCommand("archtrace.showStatus", () => {
      const clients = server?.clientCount ?? 0;
      void vscode.window.showInformationMessage(
        `ArchTrace ${host}:${port} · ${clients} client(s)`,
      );
    }),
    vscode.commands.registerCommand("archtrace.restartServer", () => {
      scheduleRestart();
    }),
    vscode.commands.registerCommand("archtrace.scanWorkspace", () => {
      void scanWorkspace();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (affectsSettings(event)) {
        scheduleRestart();
      }
    }),
  );
}

export function deactivate(): Promise<void> {
  sourceWatcher?.dispose();
  scanner?.dispose();
  return server?.stop() ?? Promise.resolve();
}

async function scanWorkspace(): Promise<void> {
  if (!scanner) return;
  const started = Date.now();
  try {
    const map = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "ArchTrace: indexando el workspace" },
      () => scanner?.scan() ?? Promise.reject(new Error("Scanner no disponible")),
    );
    const elapsed = Date.now() - started;
    const line = `Scan: ${map.stats.files} files · ${map.stats.symbols} symbols · ${elapsed} ms`;
    output?.appendLine(line);
    const open = "Abrir JSON";
    const choice = await vscode.window.showInformationMessage(line, open);
    if (choice === open) {
      const document = await vscode.workspace.openTextDocument({
        content: JSON.stringify(map, null, 2),
        language: "json",
      });
      await vscode.window.showTextDocument(document, { preview: true });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    output?.appendLine(`Scan failed: ${detail}`);
    void vscode.window.showErrorMessage(`ArchTrace: ${detail}`);
  }
}
