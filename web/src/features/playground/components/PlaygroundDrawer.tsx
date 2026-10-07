"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Code2,
  Crosshair,
  FileText,
  FlaskConical,
  History,
  Loader2,
  MessagesSquare,
  PanelRightOpen,
  Paperclip,
  Play,
  Search,
  Square,
  X,
  Zap,
} from "lucide-react";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { useGraphName } from "@/features/canvas/lib/useGraphName";
import { formatRatio, formatRunCost, formatRunLatency, type RunRecord } from "@/features/runs/lib/runLog";
import { RunHistoryModal } from "@/features/runs/RunHistoryModal";
import { useRuns } from "@/features/runs/store";
import { FIELD_CLASS, RIGHT_PANEL_CLASS } from "@/features/canvas/theme";
import { AI_PROVIDERS, modelLabel, type AiProviderId } from "@/lib/ai/catalog";
import { resolvePrice } from "@/lib/ai/costEstimate";
import { shortlistModels } from "@/lib/ai/modelShortlist";
import { formatPrice } from "@/lib/ai/ragCostEstimator";
import { useConnectedModels, useProviderStatus, useVerifying, type SelectableModel } from "@/lib/ai/providerStatus";
import { useAiSettings } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import { canRunProfile, cancelPlayground, runPlayground } from "../hooks/usePlaygroundTrace";
import { stageLabel } from "../lib/exportRunReport";
import { ACCEPTED_DOCUMENTS, extractDocumentText } from "../lib/extractText";
import { entryInputs, systemEntryLabel } from "../lib/entryPoint";
import { PLAYGROUND_PRESETS, type PlaygroundPresetIcon } from "../lib/presets";
import { formatLatency } from "../lib/traceState";
import { syncPlaygroundProvider, usePlaygroundStore, type PlaygroundProviderId } from "../store";
import { GenericProbeForm, GenericResultsPanel, ProfileSelector } from "./GenericProbe";
import { PlaygroundResultsPanel } from "./PlaygroundResultsPanel";

const FIELD = `${FIELD_CLASS} px-2.5 py-1.5`;
const QUESTION_PLACEHOLDER = "Ej.: ¿Cómo se trocea el documento antes de generar los embeddings?";
const DOCUMENT_PLACEHOLDER = "…o pega aquí el texto del documento. Ej.: un README, unas notas de la clase o un fragmento de tu código.";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-3";
const CHIP =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-teal-100 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-50";
/** Tira a la que se reduce el panel mientras corre la consulta: el lienzo gana el espacio para la traza. */
const COLLAPSED_PANEL_CLASS = "flex w-16 shrink-0 flex-col items-center gap-3 border-l border-line bg-white py-3 outline-none";

const RUN_LABEL = { rag: "Ejecutar consulta", http: "Lanzar petición", event: "Inyectar evento" } as const;

/**
 * "Probar / Simular" en la columna derecha (la misma que ocupa el panel de detalles, que se cierra al
 * abrirlo). Un selector de perfil arriba: RAG (consulta real con IA), petición HTTP o evento; RAG es
 * un perfil más. Dos pestañas: "Consulta" (pregunta, documento, modelo y traza en vivo) y "Resultado" (respuesta,
 * recorrido por nodo y fragmentos). `resultsOpen` elige la pestaña: al terminar una corrida salta sola
 * a "Resultado". Mientras corre, el panel se reduce a una tira (`collapsed`) para que la traza se vea
 * en el lienzo. El lienzo queda siempre libre: nada se pinta encima.
 */
export function PlaygroundDrawer() {
  const open = usePlaygroundStore((state) => state.open);
  const status = usePlaygroundStore((state) => state.status);
  const question = usePlaygroundStore((state) => state.question);
  const documentText = usePlaygroundStore((state) => state.documentText);
  const error = usePlaygroundStore((state) => state.error);
  const result = usePlaygroundStore((state) => state.result);
  const traceResult = usePlaygroundStore((state) => state.traceResult);
  const profile = usePlaygroundStore((state) => state.profile);
  const showResults = usePlaygroundStore((state) => state.resultsOpen);
  const demo = usePlaygroundStore((state) => state.demo);
  const collapsed = usePlaygroundStore((state) => state.collapsed);
  const questionId = useId();
  const documentId = useId();
  const graphName = useGraphName();
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!open) return null;

  const running = status === "running";
  const store = usePlaygroundStore.getState;
  const isRag = profile === "rag";
  const canRun = canRunProfile({ profile, question, documentText }) && !running;
  const hasResult = isRag ? result !== null : traceResult !== null;

  if (collapsed) return <CollapsedPanel />;

  return (
    <aside
      aria-label="Probar / Simular"
      data-right-panel
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !running) store().setOpen(false);
      }}
      className={cn(RIGHT_PANEL_CLASS, "h-full overflow-hidden")}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-3">
        <h2 className="shrink-0 text-sm font-semibold text-ink">Probar / Simular</h2>
        <EntryBadge running={running} />
        {demo ? (
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">Demo</span>
        ) : null}
        <button
          type="button"
          aria-label="Historial de ejecuciones"
          title="Historial de ejecuciones"
          onClick={() => setHistoryOpen(true)}
          className="grid size-6 shrink-0 place-items-center rounded text-ink-2 hover:bg-neutral-100 hover:text-ink"
        >
          <History className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Cerrar el playground"
          onClick={() => store().setOpen(false)}
          className="grid size-6 shrink-0 place-items-center rounded text-ink-2 hover:bg-neutral-100 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <ProfileSelector disabled={running} />

      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3">
        <div role="tablist" aria-label="Probar / Simular" className="flex gap-4">
          <PanelTab selected={!showResults} onSelect={() => store().setResultsOpen(false)}>
            Consulta
          </PanelTab>
          <PanelTab selected={showResults} disabled={!hasResult} onSelect={() => store().setResultsOpen(true)}>
            Resultado
            {hasResult && !showResults ? <span className="size-1.5 rounded-full bg-teal-500" aria-label="nuevo" /> : null}
          </PanelTab>
        </div>
        <div className="ml-auto flex min-w-0 justify-end">
          {!isRag ? null : demo ? <DemoModelChip model={demo.model} /> : <ModelSelect disabled={running} />}
        </div>
      </div>

      {showResults ? (
        <div role="tabpanel" aria-label="Resultado" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {isRag ? <PlaygroundResultsPanel /> : <GenericResultsPanel />}
        </div>
      ) : (
        <>
          <div role="tabpanel" aria-label="Consulta" className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 [&>*]:shrink-0">
            {isRag ? (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor={questionId} className={LABEL}>
                    Pregunta
                  </label>
                  <textarea
                    id={questionId}
                    rows={2}
                    value={question}
                    disabled={running}
                    placeholder={demo ? "¿Qué quieres preguntarle al documento?" : QUESTION_PLACEHOLDER}
                    onChange={(event) => store().setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canRun) void runPlayground();
                    }}
                    className={cn(FIELD, "min-h-14 resize-y")}
                  />
                </div>

                <PresetChips disabled={running} />

                <DocumentField inputId={documentId} disabled={running} label={demo?.inputLabel ?? "Documento"} />

                {demo ? null : <ModelNotice />}

                <Conversation graphName={graphName} disabled={running} onShowAll={() => setHistoryOpen(true)} />
              </>
            ) : (
              <GenericProbeForm disabled={running} onSubmit={() => void runPlayground()} />
            )}

            {status !== "idle" ? <StageList /> : null}

            {error ? (
              <p role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
            <div className="ml-auto flex gap-2">
              {running ? (
                <button
                  type="button"
                  onClick={cancelPlayground}
                  className="inline-flex items-center gap-1.5 rounded-md border py-1.5 border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
                >
                  <Square className="size-3.5" aria-hidden />
                  Cancelar
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canRun}
                onClick={() => void runPlayground()}
                title={canRun ? "Ctrl + Enter" : isRag ? "Escribe una pregunta y añade un documento" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-teal-600 to-teal-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:from-teal-500 hover:to-teal-500 hover:shadow-lg hover:shadow-teal-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100"
              >
                {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                {running ? "Ejecutando…" : RUN_LABEL[profile]}
              </button>
            </div>
          </footer>
        </>
      )}
      {historyOpen ? <RunHistoryModal graphName={graphName} onClose={() => setHistoryOpen(false)} /> : null}
    </aside>
  );
}

/** Turnos que se muestran en el hilo; el resto queda en el historial completo. */
const CONVERSATION_TURNS = 6;

/**
 * Hilo de chat del pipeline, colapsado por defecto. Cabecera mínima: solo chevron + conteo.
 * El historial completo vive en el modal (icono History del header del drawer).
 */
function Conversation({ graphName, disabled, onShowAll }: { graphName: string | null; disabled: boolean; onShowAll: () => void }) {
  const all = useRuns(graphName);
  const runs = all.filter((run) => run.profile === "rag");
  const [open, setOpen] = useState(false);
  if (!graphName || runs.length === 0) return null;
  const turns = runs.slice(0, CONVERSATION_TURNS).reverse();
  const label = runs.length === 1 ? "1 turno anterior" : `${runs.length} turnos anteriores`;
  return (
    <section className="flex flex-col gap-1" aria-label="Conversación">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-left text-[11px] font-medium text-ink-3 hover:text-ink"
      >
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", open ? "rotate-0" : "-rotate-90")}
          aria-hidden
        />
        <MessagesSquare className="size-3.5 shrink-0" aria-hidden />
        <span>{label}</span>
      </button>
      {open ? (
        <>
          <ol className="scrollbar-thin flex max-h-48 flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-neutral-50/60 p-2">
            {turns.map((run) => (
              <ChatTurn key={run.id} run={run} disabled={disabled} />
            ))}
          </ol>
          <button type="button" onClick={onShowAll} className="self-start text-[11px] text-ink-3 underline hover:text-ink">
            Historial completo
          </button>
        </>
      ) : null}
    </section>
  );
}

function ChatTurn({ run, disabled }: { run: RunRecord; disabled: boolean }) {
  return (
    <li className="flex flex-col gap-1">
      <p className="ml-8 self-end rounded-lg rounded-br-sm bg-teal-600 px-2.5 py-1.5 text-xs text-white [overflow-wrap:anywhere]">{run.question}</p>
      <div className="mr-8 flex flex-col gap-1 rounded-lg rounded-bl-sm border border-line bg-white px-2.5 py-1.5">
        <p className="line-clamp-4 whitespace-pre-wrap text-xs text-ink [overflow-wrap:anywhere]">{run.answer}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-3">
          <span title="Latencia total">{formatRunLatency(run.totalLatencyMs)}</span>
          <span title="Tokens entrada / salida">
            {run.usage.promptTokens}/{run.usage.completionTokens} tok
          </span>
          <span title="Coste estimado">{formatRunCost(run.costUsd)}</span>
          {run.metrics ? <span title="Relevancia media de los fragmentos">rel. {formatRatio(run.metrics.meanScore)}</span> : null}
          <button
            type="button"
            disabled={disabled}
            onClick={() => usePlaygroundStore.getState().setQuestion(run.question)}
            className="ml-auto font-sans text-[11px] text-teal-700 underline disabled:opacity-40"
          >
            Repetir
          </button>
        </div>
      </div>
    </li>
  );
}

function PanelTab({
  selected,
  disabled = false,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-40",
        selected ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Punto de entrada de la corrida y las variables que ese nodo espera recibir. */
function EntryBadge({ running }: { running: boolean }) {
  const entry = usePlaygroundStore((state) => state.entry);
  const profile = usePlaygroundStore((state) => state.profile);
  const label = entry?.label ?? systemEntryLabel(profile);
  const inputs = entryInputs(entry, profile).join(", ");
  return (
    <div
      title={`Entrada: ${label} · Requiere: ${inputs}`}
      className={cn(
        "mr-auto flex h-6 min-w-0 items-center gap-1 rounded-md border border-teal-200 bg-teal-50/60 pl-2 text-xs text-teal-900",
        entry ? "pr-0.5" : "pr-2",
      )}
    >
      <Crosshair className="size-3.5 shrink-0 text-teal-600" aria-hidden />
      <span className="sr-only">Entrada:</span>
      <span className="min-w-0 truncate font-semibold">{label}</span>
      {entry ? (
        <button
          type="button"
          disabled={running}
          title={profile === "rag" ? "Lanzar contra el sistema completo" : "Elegir la entrada automáticamente"}
          aria-label={profile === "rag" ? "Volver al sistema completo" : "Entrada automática"}
          onClick={() => usePlaygroundStore.getState().clearEntry()}
          className="grid size-5 shrink-0 place-items-center rounded text-teal-700 hover:bg-teal-100 disabled:opacity-40"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Ejemplos rápidos: rellenan pregunta y documento. En una demo solo vale el suyo (la respuesta está grabada). */
function PresetIcon({ name }: { name: PlaygroundPresetIcon }) {
  const Icon = name === "code" ? Code2 : FileText;
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}

function PresetChips({ disabled }: { disabled: boolean }) {
  const demo = usePlaygroundStore((state) => state.demo);
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>Ejemplos rápidos</span>
      <div className="flex flex-wrap gap-1.5">
        {demo ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              usePlaygroundStore.getState().setQuestion(demo.question);
              usePlaygroundStore.getState().setDocument(demo.documentText, demo.documentName);
            }}
            className={CHIP}
          >
            <Clapperboard className="size-3.5 shrink-0" aria-hidden />
            Ejemplo de la demo
          </button>
        ) : (
          PLAYGROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              title={preset.question}
              onClick={() => usePlaygroundStore.getState().applyPreset(preset)}
              className={CHIP}
            >
              <PresetIcon name={preset.icon} />
              {preset.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Panel reducido durante la corrida: progreso por etapa, desplegar y cancelar. */
function CollapsedPanel() {
  const stages = usePlaygroundStore((state) => state.stages);
  const running = usePlaygroundStore((state) => state.status === "running");
  return (
    <aside aria-label="Probar en vivo (minimizado)" data-right-panel tabIndex={-1} className={COLLAPSED_PANEL_CLASS}>
      <button
        type="button"
        aria-label="Desplegar el panel"
        title="Desplegar el panel"
        onClick={() => usePlaygroundStore.getState().setCollapsed(false)}
        className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-teal-500"
      >
        <PanelRightOpen className="size-4" aria-hidden />
      </button>
      <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-teal-600 to-teal-600 text-white" aria-hidden>
        <Zap className={cn("size-4", running && "animate-pulse")} />
      </span>
      <ol aria-label="Traza" aria-live="polite" className="scrollbar-thin flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
        {stages.map((item, index) => (
          <li
            key={index}
            title={`${stageLabel(item)}${item.latencyMs !== undefined ? ` · ${formatLatency(item.latencyMs)}` : ""}${item.upstream ? " (preparación)" : ""}`}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
              item.status === "active"
                ? "bg-teal-100 text-teal-700 ring-2 ring-teal-400"
                : item.status === "error"
                  ? "bg-rose-100 text-rose-700 ring-2 ring-rose-300"
                  : item.upstream
                  ? "bg-neutral-100 text-ink-3"
                  : "bg-teal-100 text-teal-700",
            )}
          >
            {item.status === "active" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : stageLabel(item).slice(0, 2)}
          </li>
        ))}
      </ol>
      {running ? (
        <button
          type="button"
          aria-label="Cancelar la consulta"
          title="Cancelar"
          onClick={cancelPlayground}
          className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          <Square className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}

function DocumentField({ inputId, disabled, label }: { inputId: string; disabled: boolean; label: string }) {
  const documentText = usePlaygroundStore((state) => state.documentText);
  const documentName = usePlaygroundStore((state) => state.documentName);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLoading(true);
    setFileError(null);
    try {
      usePlaygroundStore.getState().setDocument(await extractDocumentText(file), file.name);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    // Sin min-h explícito (y con shrink-0 desde el panel): su altura mínima es la del contenido, así
    // que al aparecer la traza debajo el bloque no encoge y el textarea no la pisa.
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className={LABEL}>
          {label}
        </label>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => fileRef.current?.click()}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Paperclip className="size-3.5" aria-hidden />}
          Adjuntar .txt / .md / .pdf
        </button>
        <input ref={fileRef} type="file" accept={ACCEPTED_DOCUMENTS} className="hidden" onChange={(event) => void onFile(event)} />
      </div>
      {documentName ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-2">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{documentName}</span>
          <span className="shrink-0 text-ink-3">· {documentText.length.toLocaleString("es")} car.</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => usePlaygroundStore.getState().setDocument("", null)}
            className="ml-auto shrink-0 underline hover:text-ink"
          >
            Quitar
          </button>
        </p>
      ) : null}
      <textarea
        id={inputId}
        value={documentText}
        disabled={disabled}
        placeholder={DOCUMENT_PLACEHOLDER}
        onChange={(event) => usePlaygroundStore.getState().setDocument(event.target.value, documentName)}
        className={cn(FIELD, "scrollbar-thin min-h-[180px] flex-1 resize-none font-mono text-xs leading-5")}
      />
      {fileError ? <p className="text-xs text-rose-700">{fileError}</p> : null}
    </div>
  );
}

/**
 * Selector de proveedor + modelo, en la fila de las pestañas. Solo lista proveedores con API key
 * verificada (vault de API & Integración) y los modelos que su API devolvió: una lista corta (catálogo
 * primero) con búsqueda y "Ver todos" para el resto, con la tarifa como texto secundario.
 */
function ModelSelect({ disabled }: { disabled: boolean }) {
  const provider = usePlaygroundStore((state) => state.provider);
  const model = usePlaygroundStore((state) => state.model);
  const prices = useAiSettings((state) => state.prices);
  const groups = useConnectedModels();
  const verifying = useVerifying();
  const connectedKey = groups.map((group) => group.provider).join(",");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AiProviderId>(provider);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Al terminar las verificaciones, si el proveedor actual no quedó conectado se pasa a uno que sí.
  useEffect(() => {
    if (connectedKey) syncPlaygroundProvider();
  }, [connectedKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (groups.length === 0) {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded border border-line px-1.5 text-xs text-ink-3">
        {verifying ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        {verifying ? "Verificando claves…" : "Sin claves verificadas"}
      </span>
    );
  }

  const listed = groups.some((group) => group.provider === provider && group.models.some((item) => item.id === model));
  const price = resolvePrice(provider, model, prices);
  const active = groups.find((group) => group.provider === tab) ?? groups[0]!;
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? active.models.filter((item) => item.id.toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle))
    : active.models;
  const { shortlist, rest } = shortlistModels(active.provider, matches, { keep: active.provider === provider ? model : undefined });
  const visible = showAll ? [...shortlist, ...rest] : shortlist;

  const toggle = (): void => {
    if (!open) {
      setTab(provider);
      setQuery("");
      setShowAll(false);
    }
    setOpen(!open);
  };
  const pick = (item: SelectableModel): void => {
    const store = usePlaygroundStore.getState();
    if (item.provider !== provider) store.setProvider(item.provider as PlaygroundProviderId);
    store.setModel(item.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onKeyDown={(event) => {
        // Escape cierra el selector, no el panel entero.
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={`${AI_PROVIDERS[provider].label} · ${modelLabel(provider, model)} · ${formatPrice(price.price)}`}
        onClick={toggle}
        className="inline-flex h-6 max-w-[12rem] min-w-0 items-center gap-1 rounded border border-line bg-white pl-1.5 pr-1 text-xs text-ink-2 hover:text-ink focus-visible:border-teal-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500 disabled:opacity-60"
      >
        <span className={cn("min-w-0 truncate", !listed && "text-amber-700")}>
          {modelLabel(provider, model)}
          {listed ? "" : " (no disponible)"}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Elegir modelo"
          className="absolute right-0 top-full z-30 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-white shadow-lg dark:bg-slate-900"
        >
          {groups.length > 1 ? (
            <div className="flex flex-wrap gap-1 border-b border-line p-2" role="radiogroup" aria-label="Proveedor">
              {groups.map((group) => (
                <button
                  key={group.provider}
                  type="button"
                  role="radio"
                  aria-checked={group.provider === active.provider}
                  onClick={() => {
                    setTab(group.provider);
                    setShowAll(false);
                  }}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                    group.provider === active.provider ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {AI_PROVIDERS[group.provider].label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              autoFocus
              type="search"
              aria-label="Buscar modelo"
              placeholder={`Buscar en ${AI_PROVIDERS[active.provider].label}…`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowAll(false);
              }}
              className={cn(FIELD_CLASS, "h-7 w-full py-0 pl-7 pr-2 text-xs")}
            />
          </div>

          <ul role="listbox" aria-label="Modelos" className="scrollbar-thin max-h-64 overflow-y-auto p-1">
            {visible.length === 0 ? <li className="px-2 py-3 text-center text-xs text-ink-3">Ningún modelo coincide.</li> : null}
            {visible.map((item) => {
              const current = item.provider === provider && item.id === model;
              return (
                <li key={item.id} role="option" aria-selected={current}>
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    title={item.id}
                    className={cn(
                      "flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none dark:hover:bg-slate-800",
                      current && "font-semibold text-teal-800",
                    )}
                  >
                    <span className="grid size-3.5 shrink-0 place-items-center pt-0.5">{current ? <Check className="size-3.5" aria-hidden /> : null}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      <span className={cn("truncate text-[10px] font-normal", item.priceSource === "unknown" ? "text-amber-700" : "text-ink-3")}>
                        {modelPriceText(item)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {rest.length > 0 && !showAll ? (
              <li>
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="w-full rounded px-1.5 py-1 text-left text-[11px] font-medium text-teal-700 hover:bg-neutral-100 dark:hover:bg-slate-800"
                >
                  Ver todos ({rest.length} más)
                </button>
              </li>
            ) : null}
          </ul>

          <Link href={DASHBOARD_ROUTES.api} className="border-t border-line px-3 py-2 text-[11px] text-teal-700 underline">
            Gestionar claves y modelos en API & Integración
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Texto secundario de un modelo en el selector: su tarifa, "Local · 0 $" o "sin tarifa". */
function modelPriceText(item: SelectableModel): string {
  if (item.priceSource === "local") return "Local · 0 $";
  if (!item.price) return "sin tarifa";
  return `${formatPrice(item.price)}${item.priceSource === "custom" ? " (manual)" : ""}`;
}

/** Aviso bajo el formulario solo cuando hace falta: clave inválida, sin saldo, sin tarifa o modelo local. */
function ModelNotice() {
  const provider = usePlaygroundStore((state) => state.provider);
  const model = usePlaygroundStore((state) => state.model);
  const check = useProviderStatus((state) => state.checks[provider]);
  const prices = useAiSettings((state) => state.prices);
  const info = AI_PROVIDERS[provider];
  const price = resolvePrice(provider, model, prices);

  const warn = (text: ReactNode) => (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {text}{" "}
        <Link href={DASHBOARD_ROUTES.api} className="font-semibold underline">
          Abrir API & Integración
        </Link>
      </p>
    </div>
  );

  if (check.status === "auth_error") return warn(<>La API key de {info.label} no es válida (Error de autenticación).</>);
  if (check.status === "quota") return warn(<>{check.message ?? `La clave de ${info.label} no tiene saldo.`}</>);
  if (check.status === "unconfigured") return warn(<>No hay API key de {info.label} en el vault ni en el servidor.</>);
  if (check.status === "error") return warn(<>No se pudo verificar {info.label}: {check.message}</>);
  if (price.source === "unknown") {
    return warn(<>«{model}» no tiene tarifa conocida: el coste saldrá como «sin tarifa». Puedes fijar su precio por 1M de tokens.</>);
  }
  if (provider === "ollama") {
    return (
      <p className="text-xs text-slate-500">
        Servidor local (Ollama / vLLM), coste 0 $. Requiere el servidor arrancado y el modelo descargado.
      </p>
    );
  }
  return (
    <p className="text-xs text-slate-500">
      Tarifa: {formatPrice(price.price)}
      {price.source === "custom" ? " (manual)" : ""}.
    </p>
  );
}

/** En una demo no se elige proveedor: la respuesta está precalculada y se reproduce en el navegador. */
function DemoModelChip({ model }: { model: string }) {
  return (
    <span
      title={`${model}. Traza y respuesta simuladas: no se envía nada a ningún proveedor ni hace falta API key.`}
      className="inline-flex h-6 min-w-0 items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 text-xs text-teal-800"
    >
      <FlaskConical className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{model}</span>
    </span>
  );
}

function StageList() {
  const stages = usePlaygroundStore((state) => state.stages);
  if (stages.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>Traza</span>
      <ol className="flex flex-col gap-1 text-sm" aria-live="polite">
        {stages.map((item, index) => (
          <li
            key={index}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5",
              item.status === "error" ? "items-start bg-rose-50" : "bg-neutral-50",
              item.upstream && "opacity-60",
            )}
          >
            {item.status === "active" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-teal-600" aria-hidden />
            ) : item.status === "error" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-600" aria-hidden />
            ) : (
              <CheckCircle2 className="size-3.5 shrink-0 text-teal-500" aria-hidden />
            )}
            <span className="shrink-0 font-medium text-ink">{stageLabel(item)}</span>
            {item.upstream ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">prep.</span> : null}
            {/* El error (clave inválida, sin saldo, rate-limit…) se lee entero en la traza, sin recortar. */}
            <span
              className={cn("min-w-0 flex-1 text-xs", item.status === "error" ? "text-rose-800 [overflow-wrap:anywhere]" : "truncate text-ink-3")}
              title={item.detail}
            >
              {item.detail ?? (item.nodeId ? "" : "sin nodo en el grafo")}
            </span>
            {item.latencyMs !== undefined ? (
              <span className="shrink-0 font-mono text-xs text-ink-2">{formatLatency(item.latencyMs)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
