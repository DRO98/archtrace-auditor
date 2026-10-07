import type {
  CanvasToIdeMessage,
  GitDiffPayload,
  GitRefsPayload,
  IdeStateChangedPayload,
  LocalServicesDiscoveredPayload,
  SourceFilesChangedPayload,
} from "@core/protocol";
import type { ProjectMap } from "@core/projectMap";
import { buildRequestGitDiff, buildRequestGitRefs, buildRequestLocalServices, buildRequestProjectMap, parseIdeMessage } from "../protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface TeacherSocketSnapshot {
  status: ConnectionStatus;
  ideState: IdeStateChangedPayload | null;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

export class TeacherSocketManager {
  private holders = 0;
  private generation = 0;
  private attempt = 0;
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly sourceListeners = new Set<(change: SourceFilesChangedPayload) => void>();
  private readonly serviceListeners = new Set<(result: LocalServicesDiscoveredPayload) => void>();
  private snapshot: TeacherSocketSnapshot = { status: "closed", ideState: null };
  /** Peticiones con respuesta por `requestId` (git): se resuelven con el payload de la respuesta. */
  private readonly pendingReplies = new Map<
    string,
    { resolve: (payload: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly pendingMaps = new Map<
    string,
    { resolve: (map: ProjectMap) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly url: string) {}

  connect(): void {
    this.holders += 1;
    if (this.holders === 1) {
      this.openSocket();
    }
  }

  disconnect(): void {
    if (this.holders === 0) {
      return;
    }
    this.holders -= 1;
    if (this.holders === 0) {
      this.teardown();
    }
  }

  requestProjectMap(timeoutMs = 60_000): Promise<ProjectMap> {
    const requestId = createRequestId();
    const message = buildRequestProjectMap(requestId);
    if (!message || !this.send(message)) {
      return Promise.reject(new Error("El IDE no está conectado. Abre el workspace en VS Code con ArchTrace."));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMaps.delete(requestId);
        reject(new Error("El IDE no respondió con el mapa del proyecto."));
      }, timeoutMs);
      this.pendingMaps.set(requestId, { resolve, reject, timer });
    });
  }

  /** Ramas y últimos commits del workspace. */
  requestGitRefs(timeoutMs = 15_000): Promise<GitRefsPayload> {
    return this.requestReply((id) => buildRequestGitRefs(id), timeoutMs) as Promise<GitRefsPayload>;
  }

  /** Archivos cambiados entre `base` y `head` (o el árbol de trabajo si `head` es null). */
  requestGitDiff(base: string, head: string | null, timeoutMs = 20_000): Promise<GitDiffPayload> {
    return this.requestReply((id) => buildRequestGitDiff(id, base, head), timeoutMs) as Promise<GitDiffPayload>;
  }

  private requestReply(build: (requestId: string) => CanvasToIdeMessage | null, timeoutMs: number): Promise<unknown> {
    const requestId = createRequestId();
    const message = build(requestId);
    if (!message) return Promise.reject(new Error("Petición no válida."));
    if (!this.send(message)) {
      return Promise.reject(new Error("El IDE no está conectado. Abre el workspace en VS Code con ArchTrace."));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(requestId);
        reject(new Error("El IDE no respondió a tiempo."));
      }, timeoutMs);
      this.pendingReplies.set(requestId, { resolve, reject, timer });
    });
  }

  private settleReply(requestId: string, payload: unknown): void {
    const pending = this.pendingReplies.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingReplies.delete(requestId);
    pending.resolve(payload);
  }

  /**
   * Pide a la extensión que sondee servicios locales. La respuesta llega como `LOCAL_SERVICES_DISCOVERED`
   * a los suscriptores (igual que el envío espontáneo al conectar). false si el IDE no está conectado.
   */
  requestLocalServices(): boolean {
    const message = buildRequestLocalServices(createRequestId());
    return message !== null && this.send(message);
  }

  /** Servicios locales anunciados por la extensión (al conectar o tras `requestLocalServices`). */
  subscribeLocalServices(listener: (result: LocalServicesDiscoveredPayload) => void): () => void {
    this.serviceListeners.add(listener);
    return () => {
      this.serviceListeners.delete(listener);
    };
  }

  send(msg: CanvasToIdeMessage): boolean {
    const socket = this.socket;
    if (this.snapshot.status !== "open" || !socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch (error) {
      // El socket puede cerrarse entre la comprobación y el envío: se trata como "no conectado".
      console.warn("[teacher] no se pudo enviar al IDE", error);
      return false;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Cambios de archivos fuente en el IDE. Es un evento, no estado: no forma parte del snapshot. */
  subscribeSourceChanges(listener: (change: SourceFilesChangedPayload) => void): () => void {
    this.sourceListeners.add(listener);
    return () => {
      this.sourceListeners.delete(listener);
    };
  }

  getSnapshot(): TeacherSocketSnapshot {
    return this.snapshot;
  }

  private openSocket(): void {
    this.clearRetry();
    const generation = ++this.generation;
    this.publishStatus("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      // URL mal formada (NEXT_PUBLIC_TEACHER_WS_URL): reintentar no la arreglaría.
      console.error(`[teacher] URL del puente del IDE no válida: ${this.url}`, error);
      this.publishClosed();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (generation !== this.generation) {
        socket.close();
        return;
      }
      this.attempt = 0;
      this.publishStatus("open");
    };

    socket.onmessage = (event: MessageEvent) => {
      if (generation !== this.generation || typeof event.data !== "string") {
        return;
      }
      const message = parseIdeMessage(event.data);
      if (!message) return;
      try {
        this.dispatch(message);
      } catch (error) {
        // Un suscriptor que falla no debe tumbar el canal ni dejar sin avisar al resto.
        console.error("[teacher] error al procesar un mensaje del IDE", error);
      }
    };

    socket.onerror = () => {
      // onclose schedules the reconnect. Invalid frames never throw.
    };

    socket.onclose = () => {
      if (generation !== this.generation) {
        return;
      }
      this.socket = null;
      this.rejectPending(new Error("Se cerró la conexión con el IDE."));
      this.publishClosed();
      if (this.holders > 0) {
        this.scheduleReconnect();
      }
    };
  }

  private dispatch(message: NonNullable<ReturnType<typeof parseIdeMessage>>): void {
    switch (message.action) {
      case "IDE_STATE_CHANGED":
        this.publishIdeState(message.payload);
        return;
      case "PROJECT_MAP":
        this.settleMap(message.payload.requestId, message.payload.map);
        return;
      case "PROJECT_MAP_ERROR":
        this.failMap(message.payload.requestId, new Error(message.payload.message));
        return;
      case "SOURCE_FILES_CHANGED":
        notifyAll(this.sourceListeners, message.payload);
        return;
      case "LOCAL_SERVICES_DISCOVERED":
        notifyAll(this.serviceListeners, message.payload);
        return;
      case "GIT_REFS":
      case "GIT_DIFF":
        this.settleReply(message.payload.requestId, message.payload);
        return;
      default:
        return;
    }
  }

  private teardown(): void {
    this.clearRetry();
    this.generation += 1;
    this.attempt = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
    this.rejectPending(new Error("Se cerró la conexión con el IDE."));
    this.publishClosed();
  }

  private scheduleReconnect(): void {
    this.clearRetry();
    const cap = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt += 1;
    const delay = Math.round(cap * (0.5 + Math.random() * 0.5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.holders > 0) {
        this.openSocket();
      }
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private publishStatus(status: ConnectionStatus): void {
    if (this.snapshot.status === status) {
      return;
    }
    this.snapshot = { status, ideState: this.snapshot.ideState };
    this.emit();
  }

  /** A closed bridge has no IDE state: drop it so the canvas never shows a stale cursor. */
  private publishClosed(): void {
    if (this.snapshot.status === "closed" && this.snapshot.ideState === null) {
      return;
    }
    this.snapshot = { status: "closed", ideState: null };
    this.emit();
  }

  private publishIdeState(ideState: IdeStateChangedPayload): void {
    const previous = this.snapshot.ideState;
    if (
      previous &&
      previous.activeFile === ideState.activeFile &&
      previous.cursorLine === ideState.cursorLine &&
      previous.status === ideState.status
    ) {
      return;
    }
    this.snapshot = { status: this.snapshot.status, ideState };
    this.emit();
  }

  private settleMap(requestId: string, map: ProjectMap): void {
    const pending = this.pendingMaps.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMaps.delete(requestId);
    pending.resolve(map);
  }

  private failMap(requestId: string, error: Error): void {
    const pending = this.pendingMaps.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMaps.delete(requestId);
    pending.reject(error);
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pendingMaps) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingMaps.delete(requestId);
    }
    for (const [requestId, pending] of this.pendingReplies) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingReplies.delete(requestId);
    }
  }

  private emit(): void {
    notifyAll(this.listeners, undefined);
  }
}

/** Avisa a todos los suscriptores aunque alguno lance: el error se registra y el resto sigue recibiendo. */
function notifyAll<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("[teacher] un suscriptor del puente del IDE falló", error);
    }
  }
}

function createRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
