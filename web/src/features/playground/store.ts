import { create } from "zustand";
import type { PlaygroundModuleRef, RagResultEvent } from "@core/playground";
import type { TraceGenericResult, TraceProfileId } from "@core/trace";
import type { HttpMethod } from "@/features/trace/runners";
import type { TraceGraphEdge } from "@/lib/trace/graphWalk";
import type { DemoPlayground } from "@/features/demos/types";
import type { RoutingEdge } from "@/features/simulation/lib/route";
import { AI_PROVIDER_IDS, AI_PROVIDERS, isUsableKey, type AiProviderId } from "@/lib/ai/catalog";
import { priceKey, type TokenPrice } from "@/lib/ai/costEstimate";
import { connectedProviders, useProviderStatus } from "@/lib/ai/providerStatus";
import { currentSettings, modelFor, selectionFor, type AiSettings } from "@/lib/ai/settings";
import type { AiSelection } from "@/lib/ai/types";
import { resolveEntry, type EntryPoint } from "./lib/entryPoint";
import type { PlaygroundPreset } from "./lib/presets";
import { EMPTY_TRACE, applyTraceEvent, startTrace, type AnyTraceEvent, type StageTrace, type TraceVisuals } from "./lib/traceState";

/** Todos los proveedores sirven `completeText`; el selector solo muestra los que tienen clave verificada. */
export const PLAYGROUND_PROVIDERS = AI_PROVIDER_IDS;
export type PlaygroundProviderId = AiProviderId;

export type PlaygroundStatus = "idle" | "running" | "done" | "error";

export type PlaygroundResult = Omit<RagResultEvent, "type"> & {
  question: string;
  documentName: string | null;
  entry: EntryPoint | null;
  stages: StageTrace[];
  finishedAt: string;
};

/** Resultado de un perfil genérico (HTTP, evento), con lo necesario para el informe y el Tracing Log. */
export type GenericTraceResult = Omit<TraceGenericResult, "type"> & {
  /** Payload inyectado, tal como se escribió. */
  input: string;
  entry: EntryPoint | null;
  stages: StageTrace[];
  finishedAt: string;
};

/**
 * Lo que el playground necesita del lienzo actual: aristas dibujadas (para pintar), aristas semánticas
 * con su `kind` (para que los runners genéricos recorran el grafo) y módulos para el mapeo de etapas.
 */
export interface PlaygroundContext {
  edges: readonly RoutingEdge[];
  modules: readonly PlaygroundModuleRef[];
  graphEdges?: readonly TraceGraphEdge[];
}

export const DEFAULT_PAYLOADS: Readonly<Record<Exclude<TraceProfileId, "rag">, string>> = {
  http: '{\n  "orderId": "A-1042",\n  "items": [{ "sku": "BOOK-7", "qty": 1 }]\n}',
  event: '{\n  "type": "order.created",\n  "orderId": "A-1042",\n  "ts": "2026-01-01T12:00:00Z"\n}',
};

interface PlaygroundState extends TraceVisuals {
  open: boolean;
  /** Perfil de "Probar / Simular": RAG (consulta con IA) o genérico (petición HTTP, evento). */
  profile: TraceProfileId;
  /** JSON que se inyecta en los perfiles genéricos. */
  payload: string;
  /** HTTP: URL real a la que llamar (opcional; sin ella la latencia es simulada). */
  targetUrl: string;
  httpMethod: HttpMethod;
  /** Último resultado de un perfil genérico. */
  traceResult: GenericTraceResult | null;
  resultsOpen: boolean;
  /** Nodo por el que se inyectan los datos; null = sistema completo (API Routes). */
  entry: EntryPoint | null;
  /** Panel reducido a una tira mientras corre la consulta, para dejar el lienzo a la traza. */
  collapsed: boolean;
  status: PlaygroundStatus;
  question: string;
  documentText: string;
  documentName: string | null;
  provider: PlaygroundProviderId;
  model: string;
  /** false hasta que el usuario toca el selector: mientras, se sigue lo guardado en Ajustes. */
  modelTouched: boolean;
  result: PlaygroundResult | null;
  error: string | null;
  setProfile: (profile: TraceProfileId) => void;
  setPayload: (payload: string) => void;
  setTargetUrl: (url: string) => void;
  setHttpMethod: (method: HttpMethod) => void;
  /** Grafo de demo cargado: la consulta se reproduce en el navegador (sin red ni API key). */
  demo: DemoPlayground | null;
  /** Abrir sin nodo = sistema completo. */
  setOpen: (open: boolean) => void;
  /** Abre el panel con `nodeId` como punto de entrada. */
  openFrom: (nodeId: string) => void;
  /** Vuelve a "sistema completo". */
  clearEntry: () => void;
  setCollapsed: (collapsed: boolean) => void;
  applyPreset: (preset: PlaygroundPreset) => void;
  setResultsOpen: (open: boolean) => void;
  setQuestion: (question: string) => void;
  setDocument: (text: string, name: string | null) => void;
  setProvider: (provider: PlaygroundProviderId) => void;
  setModel: (model: string) => void;
  configure: (context: PlaygroundContext) => void;
  /** Entra o sale del modo demo. Entrar rellena pregunta y documento; salir vacía los que dejó la demo. */
  setDemo: (demo: DemoPlayground | null) => void;
  begin: () => void;
  apply: (event: AnyTraceEvent) => void;
  fail: (message: string) => void;
  /** Vuelve a `idle`: el lienzo deja de pintar la traza. Conserva pregunta, documento y último resultado. */
  clear: () => void;
}

let context: PlaygroundContext = { edges: [], modules: [], graphEdges: [] };

export function playgroundContext(): PlaygroundContext {
  return context;
}

/**
 * Proveedor inicial: el de Ajustes si su clave está verificada; si no, el primero verificado; si aún no hay
 * verificaciones, el de Ajustes o el primero con clave guardada; si no, el servidor local.
 */
export function defaultPlaygroundProvider(settings: AiSettings, connected: readonly AiProviderId[] = []): PlaygroundProviderId {
  const saved = settings.provider;
  if (connected.length > 0) return saved && connected.includes(saved) ? saved : connected[0];
  if (saved) return saved;
  return PLAYGROUND_PROVIDERS.find((id) => AI_PROVIDERS[id].needsKey && isUsableKey(settings.keys[id])) ?? "ollama";
}

function connectedNow(): AiProviderId[] {
  return connectedProviders(useProviderStatus.getState().checks);
}

/** Modelo a usar con `provider`: el guardado si el proveedor lo sirve; si no, el del catálogo o el primero listado. */
export function preferredModel(settings: AiSettings, provider: AiProviderId): string {
  const wanted = modelFor(settings, provider);
  const check = useProviderStatus.getState().checks[provider];
  if (check.status !== "connected" || check.models.length === 0) return wanted;
  const ids = check.models.map((model) => model.id);
  if (ids.includes(wanted)) return wanted;
  return AI_PROVIDERS[provider].models.find((model) => ids.includes(model.id))?.id ?? ids[0];
}

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  ...EMPTY_TRACE,
  open: false,
  profile: "rag",
  payload: DEFAULT_PAYLOADS.http,
  targetUrl: "",
  httpMethod: "POST",
  traceResult: null,
  resultsOpen: false,
  entry: null,
  collapsed: false,
  status: "idle",
  question: "",
  documentText: "",
  documentName: null,
  provider: "ollama",
  model: AI_PROVIDERS.ollama.models[0]?.id ?? "llama3",
  modelTouched: false,
  result: null,
  error: null,
  demo: null,

  setOpen: (open) => {
    if (open && !get().modelTouched) {
      const settings = currentSettings();
      const provider = defaultPlaygroundProvider(settings, connectedNow());
      set({ provider, model: preferredModel(settings, provider) });
    }
    // Abrir desde la cabecera es "sistema completo"; una corrida en marcha conserva su punto de entrada.
    const reset = open && !get().open && get().status !== "running";
    set(open ? { open, ...(reset ? { entry: null } : {}) } : { open, collapsed: false });
  },
  openFrom: (nodeId) => {
    get().setOpen(true);
    if (get().status === "running") return;
    set({ entry: resolveEntry(nodeId, context.modules, get().demo, get().profile), resultsOpen: false });
  },
  clearEntry: () => {
    if (get().status !== "running") set({ entry: null });
  },
  setCollapsed: (collapsed) => set({ collapsed }),
  setProfile: (profile) => {
    const state = get();
    if (state.status === "running" || state.profile === profile) return;
    // Cambiar de perfil cambia el significado del punto de entrada y de la traza: se recalculan.
    const entry = state.entry ? resolveEntry(state.entry.nodeId, context.modules, state.demo, profile) : null;
    const leftDefault = state.profile !== "rag" && state.payload === DEFAULT_PAYLOADS[state.profile];
    const payload = profile !== "rag" && (leftDefault || state.payload.trim() === "") ? DEFAULT_PAYLOADS[profile] : state.payload;
    set({ ...EMPTY_TRACE, profile, entry, payload, status: "idle", error: null, resultsOpen: false, collapsed: false });
  },
  setPayload: (payload) => set({ payload }),
  setTargetUrl: (targetUrl) => set({ targetUrl }),
  setHttpMethod: (httpMethod) => set({ httpMethod }),
  applyPreset: (preset) => set({ question: preset.question, documentText: preset.documentText, documentName: preset.documentName }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
  setQuestion: (question) => set({ question }),
  setDocument: (documentText, documentName) => set({ documentText, documentName }),
  setProvider: (provider) => set({ provider, model: preferredModel(currentSettings(), provider), modelTouched: true }),
  setModel: (model) => set({ model, modelTouched: true }),
  configure: (next) => {
    const changed = next.edges !== context.edges;
    context = next;
    const entry = get().entry;
    if (entry && !next.modules.some((item) => item.id === entry.nodeId)) set({ entry: null });
    if (changed && get().status !== "running") set({ ...EMPTY_TRACE, status: "idle", collapsed: false });
  },

  setDemo: (demo) => {
    const previous = get().demo;
    if (previous === demo) return;
    const base = { ...EMPTY_TRACE, status: "idle" as const, demo, entry: null, result: null, error: null, resultsOpen: false, collapsed: false };
    if (demo) {
      set({ ...base, question: demo.question, documentText: demo.documentText, documentName: demo.documentName });
      return;
    }
    const state = get();
    const leftByDemo = previous !== null && state.question === previous.question && state.documentText === previous.documentText;
    set(leftByDemo ? { ...base, question: "", documentText: "", documentName: null } : base);
  },

  begin: () =>
    set({ ...startTrace(get().entry), status: "running", error: null, result: null, traceResult: null, resultsOpen: false, collapsed: true }),

  apply: (event) => {
    const state = get();
    if (state.status !== "running") return;
    const trace = applyTraceEvent(state, event, context.edges);
    switch (event.type) {
      case "result": {
        if (!("answer" in event)) {
          set({
            ...trace,
            traceResult: {
              profile: event.profile,
              summary: event.summary,
              output: event.output,
              totalLatencyMs: event.totalLatencyMs,
              hops: event.hops,
              errors: event.errors,
              simulated: event.simulated,
              input: state.payload,
              entry: state.entry,
              stages: trace.stages,
              finishedAt: new Date().toISOString(),
            },
          });
          return;
        }
        set({
          ...trace,
          result: {
            answer: event.answer,
            chunks: event.chunks,
            usage: event.usage,
            costUsd: event.costUsd,
            provider: event.provider,
            model: event.model,
            costBreakdown: event.costBreakdown,
            question: state.question.trim(),
            documentName: state.documentName,
            entry: state.entry,
            stages: trace.stages,
            finishedAt: new Date().toISOString(),
          },
        });
        return;
      }
      case "error":
        set({ ...trace, status: "error", error: event.message, collapsed: false });
        return;
      case "done":
        set({
          ...trace,
          status: "done",
          collapsed: false,
          resultsOpen: (get().result !== null || get().traceResult !== null) && get().error === null,
        });
        return;
      default:
        set(trace);
    }
  },

  fail: (message) => {
    const trace = applyTraceEvent(get(), { type: "error", message }, context.edges);
    set({ ...trace, status: "error", error: message, collapsed: false });
  },

  clear: () => set({ ...EMPTY_TRACE, status: "idle", error: null, resultsOpen: false, collapsed: false }),
}));

/**
 * Si el usuario no ha tocado el selector y el proveedor actual no tiene clave verificada, pasa al primero
 * que sí (se llama cuando terminan las verificaciones del vault).
 */
export function syncPlaygroundProvider(): void {
  const state = usePlaygroundStore.getState();
  if (state.modelTouched || state.status === "running") return;
  const connected = connectedNow();
  if (connected.length === 0 || connected.includes(state.provider)) return;
  const settings = currentSettings();
  const provider = defaultPlaygroundProvider(settings, connected);
  usePlaygroundStore.setState({ provider, model: preferredModel(settings, provider) });
}

/** Selección que viaja como `ai` en la petición. La clave sale del vault; sin ella, el servidor usa su `.env`. */
export function playgroundSelection(): AiSelection {
  const { provider, model } = usePlaygroundStore.getState();
  return selectionFor(currentSettings(), provider, model);
}

/** Tarifa manual del modelo elegido (API & Integración), o undefined para que el servidor use el catálogo. */
export function playgroundPricing(): TokenPrice | undefined {
  const { provider, model } = usePlaygroundStore.getState();
  return currentSettings().prices[priceKey(provider, model)];
}
