import { locate, type Timeline } from "./timeline";

export type EngineStatus = "playing" | "paused" | "finished";
export type EnginePhase = "process" | "travel" | "jump";

export interface EngineState {
  status: EngineStatus;
  /** Instante actual en ms a 1x (ya escalado por la velocidad). */
  t: number;
  totalMs: number;
  speed: number;
  /** Paso actual; durante un viaje o salto sigue siendo el paso del que se sale. */
  stepIndex: number;
  phase: EnginePhase;
  /** Solo en `travel`: salto actual dentro de la ruta. */
  hopIndex: number;
}

/** Paquete en movimiento. `progress` va de 0 a 1 a lo largo del salto, en el sentido de viaje. */
export interface EngineFrame {
  edgeId: string | null;
  reversed: boolean;
  progress: number;
}

const MAX_DT_MS = 250;
const EPSILON = 1e-6;
/** Si el paso lleva más de esto en marcha, "anterior" vuelve a su inicio en vez de al paso previo. */
const RESTART_THRESHOLD_MS = 500;

/**
 * Motor de simulación sin temporizadores ni React: el llamador le da el tiempo
 * con `advance(dtMs)` (un bucle requestAnimationFrame en la UI, o un bucle en los tests).
 * Empieza en pausa, en t = 0.
 */
export class SimulationEngine {
  private t = 0;
  private status: EngineStatus = "paused";
  private speed = 1;
  private pauseAt: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly frameListeners = new Set<() => void>();

  constructor(private readonly timeline: Timeline) {}

  get totalMs(): number {
    return this.timeline.totalMs;
  }

  getState(): EngineState {
    const { segmentIndex } = locate(this.timeline, this.t);
    const segment = segmentIndex >= 0 ? this.timeline.segments[segmentIndex] : undefined;
    let stepIndex = 0;
    let phase: EnginePhase = "process";
    let hopIndex = 0;
    if (segment?.kind === "process") {
      stepIndex = segment.stepIndex;
    } else if (segment?.kind === "travel") {
      stepIndex = segment.fromStep;
      phase = "travel";
      hopIndex = segment.hopIndex;
    } else if (segment?.kind === "jump") {
      stepIndex = segment.fromStep;
      phase = "jump";
    }
    return {
      status: this.status,
      t: this.t,
      totalMs: this.timeline.totalMs,
      speed: this.speed,
      stepIndex,
      phase,
      hopIndex,
    };
  }

  getFrame(): EngineFrame {
    const { segmentIndex, progress } = locate(this.timeline, this.t);
    const segment = segmentIndex >= 0 ? this.timeline.segments[segmentIndex] : undefined;
    if (segment?.kind === "travel") {
      return { edgeId: segment.hop.edgeId, reversed: segment.hop.reversed, progress };
    }
    return { edgeId: null, reversed: false, progress: 0 };
  }

  /** Cambios de estado (paso, fase, estado, velocidad). No se emite en cada fotograma. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Cada fotograma mientras se reproduce o se salta (para mover el paquete y el reloj). */
  subscribeFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  play(): void {
    if (this.status === "finished") this.t = 0;
    this.status = "playing";
    this.pauseAt = null;
    this.emit();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.status = "paused";
    this.pauseAt = null;
    this.emit();
  }

  toggle(): void {
    if (this.status === "playing") this.pause();
    else this.play();
  }

  /** Reproduce (con su viaje animado) hasta el inicio del paso siguiente y se pausa. En el último paso, termina. */
  next(): void {
    if (this.status === "finished") return;
    const { stepIndex } = this.getState();
    const target = this.timeline.stepStarts[stepIndex + 1];
    if (target === undefined) {
      this.t = this.timeline.totalMs;
      this.status = "finished";
      this.pauseAt = null;
      this.emit();
      return;
    }
    this.status = "playing";
    this.pauseAt = target;
    this.emit();
  }

  /** Vuelve al inicio del paso actual si ya lleva un rato en él; si no, al inicio del anterior. Deja pausado. */
  prev(): void {
    const { stepIndex, t } = this.getState();
    const currentStart = this.timeline.stepStarts[stepIndex] ?? 0;
    const restart = t - currentStart > RESTART_THRESHOLD_MS || stepIndex === 0;
    const target = restart
      ? currentStart
      : (this.timeline.stepStarts[stepIndex - 1] ?? 0);
    this.jumpTo(target);
  }

  seekStep(index: number): void {
    const start = this.timeline.stepStarts[index];
    if (start === undefined) return;
    this.jumpTo(start);
  }

  /** Coloca el reloj (p. ej. desde la barra de progreso). Por defecto pausa. */
  seekTime(ms: number, opts: { pause?: boolean } = {}): void {
    const t = Math.min(this.timeline.totalMs, Math.max(0, ms));
    this.t = t;
    this.pauseAt = null;
    if (t >= this.timeline.totalMs) this.status = "finished";
    else if (opts.pause !== false || this.status === "finished") this.status = "paused";
    this.emit();
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.speed = speed;
    this.emit();
  }

  /**
   * Avanza `dtMs` de tiempo real (escalado por la velocidad). Devuelve true si
   * cambió algo que exija repintar a nivel de paso/fase/estado.
   */
  advance(dtMs: number): boolean {
    if (this.status !== "playing") return false;
    const before = this.boundaryKey();
    const dt = Math.min(MAX_DT_MS, Math.max(0, dtMs));
    this.t += dt * this.speed;

    if (this.pauseAt !== null && this.t >= this.pauseAt - EPSILON) {
      this.t = this.pauseAt;
      this.pauseAt = null;
      this.status = "paused";
    }
    if (this.t >= this.timeline.totalMs - EPSILON) {
      this.t = this.timeline.totalMs;
      this.pauseAt = null;
      this.status = "finished";
    }

    this.emitFrame();
    const changed = before !== this.boundaryKey();
    if (changed) this.emit();
    return changed;
  }

  private jumpTo(t: number): void {
    this.t = Math.min(this.timeline.totalMs, Math.max(0, t));
    this.pauseAt = null;
    this.status = "paused";
    this.emit();
  }

  private boundaryKey(): string {
    const state = this.getState();
    return `${state.status}|${state.stepIndex}|${state.phase}|${state.hopIndex}|${state.speed}`;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
    this.emitFrame();
  }

  private emitFrame(): void {
    for (const listener of this.frameListeners) listener();
  }
}
