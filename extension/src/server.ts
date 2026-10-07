import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { CanvasToIdeMessage, IdeToCanvasMessage } from "@core/protocol";
import { parseMessage } from "./protocol.js";

export interface BridgeServerOptions {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  onError?: (error: Error) => void;
  log?: (line: string) => void;
  onClientsChanged?: (count: number) => void;
}

type Send = (message: IdeToCanvasMessage) => void;

const HEARTBEAT_MS = 30_000;

function rawToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

export class BridgeServer {
  private wss: WebSocketServer | undefined;
  private readonly clients = new Set<WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private messageHandler: ((message: CanvasToIdeMessage, reply: Send) => void) | undefined;
  private connectionHandler: ((send: Send) => void) | undefined;

  constructor(private readonly options: BridgeServerOptions) {}

  get clientCount(): number {
    return this.clients.size;
  }

  onMessage(cb: (message: CanvasToIdeMessage, reply: Send) => void): void {
    this.messageHandler = cb;
  }

  onConnection(cb: (send: Send) => void): void {
    this.connectionHandler = cb;
  }

  broadcast(message: IdeToCanvasMessage): void {
    const raw = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  start(): void {
    if (this.wss) {
      return;
    }

    const { host, port, allowedOrigins } = this.options;
    const wss = new WebSocketServer({
      host,
      port,
      maxPayload: 64 * 1024,
      verifyClient: (info: { origin: string }) => {
        if (!info.origin) {
          return true;
        }
        return allowedOrigins.includes(info.origin);
      },
    });

    this.wss = wss;

    wss.on("error", (error: Error) => {
      this.options.log?.(`Server error: ${error.message}`);
      this.options.onError?.(error);
    });

    wss.on("listening", () => {
      this.options.log?.(`Server listening on ${host}:${port}`);
    });

    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!this.alive.has(client)) {
          this.options.log?.("Dropping unresponsive client");
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        client.ping();
      }
    }, HEARTBEAT_MS);

    wss.on("connection", (socket: WebSocket) => {
      this.clients.add(socket);
      this.alive.add(socket);
      this.options.onClientsChanged?.(this.clients.size);

      socket.on("pong", () => {
        this.alive.add(socket);
      });

      socket.on("error", (error: Error) => {
        this.options.log?.(`Socket error: ${error.message}`);
      });

      const send: Send = (message) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      };

      socket.on("message", (data: RawData) => {
        try {
          const raw = rawToString(data);
          const message = parseMessage(raw);
          if (!message) {
            const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
            this.options.log?.(`Rejected message: ${preview}`);
            return;
          }
          this.messageHandler?.(message, send);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.options.log?.(`Rejected message: ${detail}`);
        }
      });

      socket.on("close", () => {
        if (this.clients.delete(socket)) {
          this.options.onClientsChanged?.(this.clients.size);
        }
      });

      this.connectionHandler?.(send);
    });
  }

  stop(): Promise<void> {
    const current = this.wss;
    this.wss = undefined;

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }

    for (const client of this.clients) {
      client.removeAllListeners();
      // Late errors after teardown must not reach an EventEmitter without listeners.
      client.on("error", () => {});
      client.terminate();
    }
    this.clients.clear();
    this.options.onClientsChanged?.(0);

    if (!current) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      current.close(() => {
        resolve();
      });
    });
  }
}
