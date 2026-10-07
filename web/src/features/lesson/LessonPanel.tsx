"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Check, ChevronDown, Footprints, Loader2, MapPinOff, MessageSquare, Plus, Settings, Sparkles, X } from "lucide-react";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { cn } from "@/lib/cn";
import { useResolvedAi, type ResolvedAi } from "@/features/canvas/lib/useResolvedAi";
import { useCanvasStore } from "@/features/canvas/store";
import { StepTimeline, type TimelineStep } from "@/features/drawer/StepTimeline";
import type { SessionNode } from "@/features/history/lib/sessionNode";
import type { ChatMessage } from "@/features/history/types";
import type { Lesson, LessonStep } from "@core/lesson";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { MarkdownAnswer } from "./components/MarkdownAnswer";
import { useLessonStore, type AskMode } from "./store";

/** Errores que no se arreglan reintentando: hay que ir a Ajustes. */
const SETTINGS_ERRORS: ReadonlySet<string> = new Set(["auth", "unconfigured"]);

const STAGE_LABEL: Record<string, string> = {
  scanning: "Leyendo el proyecto…",
  answering: "Pensando…",
  writing: "Escribiendo la lección…",
};

export function LessonPanel({ node, defaultGoal }: { node: SessionNode; defaultGoal: string }) {
  const session = useLessonStore((state) => state.session);
  const ownSession = session && session.nodeId === node.nodeId ? session : null;
  const ai = useResolvedAi();

  useEffect(() => {
    useLessonStore.getState().loadSessions();
  }, [node.nodeId]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader ai={ai} node={node} />
      {ownSession ? <Conversation key={ownSession.id} /> : <GoalForm node={node} defaultGoal={defaultGoal} ai={ai} />}
    </div>
  );
}

function PanelHeader({ ai, node }: { ai: ResolvedAi; node: SessionNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
      <SessionSwitcher node={node} />
      <button
        type="button"
        onClick={() => useLessonStore.getState().startBlank(node)}
        title="Empezar un hilo nuevo sobre este módulo (el actual se guarda en el historial)"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-500"
      >
        <Plus className="size-3.5" aria-hidden />
        Nuevo hilo
      </button>
      {ai.status === "ok" ? (
        <span
          title={ai.label}
          className="ml-auto inline-flex min-w-0 items-center gap-1 rounded-full border border-line bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-ink-2"
        >
          <Sparkles className="size-3 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{ai.label}</span>
        </span>
      ) : ai.status === "none" ? (
        <span
          title="Elige un proveedor en Ajustes de IA, o añade una clave en web/.env"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
        >
          <AlertTriangle className="size-3" aria-hidden />
          IA sin configurar
        </span>
      ) : null}
    </div>
  );
}

function SessionSwitcher({ node }: { node: SessionNode }) {
  const sessions = useLessonStore((state) => state.sessions);
  const active = useLessonStore((state) => state.session);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeHere = active && active.nodeId === node.nodeId ? active : null;
  const mine = sessions.filter((item) => item.nodeId === node.nodeId);
  const listed = activeHere && !mine.some((item) => item.id === activeHere.id) ? [activeHere, ...mine] : mine;
  const current = activeHere?.title ?? "Sin hilo activo";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== activeHere?.id) useLessonStore.getState().openSession(id);
  };

  return (
    <div
      ref={rootRef}
      className="relative min-w-0 shrink"
      onKeyDown={(event) => {
        // Escape cierra el desplegable sin cerrar el panel entero.
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sesión activa: ${current}`}
        disabled={listed.length === 0}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-2 pr-1.5 text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-500 disabled:cursor-default disabled:hover:bg-white"
      >
        <MessageSquare className="size-3.5 shrink-0 text-slate-400" aria-hidden />
        <span title={current} className="min-w-0 max-w-[180px] truncate text-xs font-medium">
          {current}
        </span>
        {listed.length > 0 ? (
          <ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
        ) : null}
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Sesiones de este componente"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {listed.map((item) => {
            const selected = item.id === activeHere?.id;
            return (
              <li key={item.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => pick(item.id)}
                  title={item.title}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs focus-visible:bg-slate-100 focus-visible:outline-none",
                    selected ? "bg-teal-50 font-semibold text-teal-700" : "font-medium text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  busy: boolean;
  placeholder: string;
  label: string;
  rows?: number;
}

/** Caja de texto estilo chat: Enter envía, Shift+Enter salta de línea, botón de envío integrado. */
function Composer({ id, value, onChange, onSubmit, canSubmit, busy, placeholder, label, rows = 2 }: ComposerProps) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-teal-300 focus-within:ring-2 focus-within:ring-teal-500">
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        rows={rows}
        aria-label={label}
        placeholder={placeholder}
        className="block max-h-48 w-full resize-none rounded-xl bg-transparent px-3 pb-11 pt-2.5 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
      />
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-end gap-2">
        <span className="text-[11px] text-slate-400">Shift + ↵ nueva línea</span>
        <button
          type="submit"
          aria-label="Enviar"
          title="Enviar (Enter)"
          disabled={!canSubmit}
          className="pointer-events-auto grid size-8 place-items-center rounded-lg bg-teal-600 text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function GoalForm({ node, defaultGoal, ai }: { node: SessionNode; defaultGoal: string; ai: ResolvedAi }) {
  const status = useLessonStore((state) => state.status);
  const error = useLessonStore((state) => state.error);
  const errorCode = useLessonStore((state) => state.errorCode);
  const unconfigured = ai.status === "none";
  const [goal, setGoal] = useState(defaultGoal);
  const [mode, setMode] = useState<AskMode>("chat");
  const busy = status === "scanning" || status === "answering" || status === "writing";
  const canSubmit = !busy && !unconfigured && goal.trim().length > 0;
  const submit = (next: AskMode = "chat") => {
    setMode(next);
    void useLessonStore.getState().ask(goal, node, next);
  };

  return (
    <form
      className="flex flex-col gap-2.5 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="text-sm font-semibold text-ink" htmlFor="lesson-goal">
        ¿Qué quieres entender?
      </label>
      <Composer
        id="lesson-goal"
        value={goal}
        onChange={setGoal}
        onSubmit={() => submit()}
        canSubmit={canSubmit}
        busy={busy && mode === "chat"}
        rows={3}
        label="¿Qué quieres entender?"
        placeholder={`Pregunta sobre ${node.nodeName}…`}
      />
      <button
        type="button"
        onClick={() => submit("lesson")}
        disabled={!canSubmit}
        title="En vez de una respuesta en texto, un recorrido por pasos que va saltando a cada parte del código"
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-teal-700 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
      >
        <Footprints className="size-3.5" aria-hidden />
        Generar lección guiada paso a paso
      </button>
      {busy ? (
        <div role="status" className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {STAGE_LABEL[status] ?? "Generando…"}
          <button
            type="button"
            onClick={() => useLessonStore.getState().cancel()}
            className="ml-auto font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
          >
            Cancelar
          </button>
        </div>
      ) : null}
      {unconfigured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Para generar lecciones elige un proveedor de IA y guarda su clave (o arranca Ollama en local).</p>
          <OpenSettingsButton />
        </div>
      ) : error ? (
        <ErrorNote message={error} code={errorCode} onRetry={() => submit(mode)} />
      ) : null}
    </form>
  );
}

function Conversation() {
  const session = useLessonStore((state) => state.session);
  const activeStep = useLessonStore((state) => state.activeStep);
  const chatStatus = useLessonStore((state) => state.chatStatus);
  const error = useLessonStore((state) => state.error);
  const errorCode = useLessonStore((state) => state.errorCode);
  const projectMap = useLessonStore((state) => state.projectMap);
  const modulesById = useCanvasStore((state) => state.indexes?.modulesById ?? null);
  const files = useMemo(
    () => (projectMap ? new Map(projectMap.files.map((file) => [file.filePath, file.lineCount])) : null),
    [projectMap],
  );
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const history = session?.history ?? [];
  const sending = chatStatus === "sending";
  // Solo la lección más reciente es interactiva (pasos ←/→ y foco del editor); las anteriores quedan como índice.
  const latestLessonIndex = history.findLastIndex((message) => message.role === "assistant" && message.lesson !== undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [history.length, sending]);

  if (!session) return null;

  const locationLabel = (codeRef: LessonStep["codeRef"]) =>
    `${modulesById?.get(codeRef.filePath)?.label ?? codeRef.filePath} · líneas ${codeRef.startLine}–${codeRef.endLine}`;

  const submit = async () => {
    if (!draft.trim() || sending) return;
    await useLessonStore.getState().followUp(draft);
    if (!useLessonStore.getState().error) setDraft("");
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ol className="flex flex-col gap-3 px-4 py-4" aria-label="Conversación">
          {history.map((message, index) =>
            message.role === "assistant" && message.lesson ? (
              <LessonMessage
                key={`${message.createdAt}-${index}`}
                intro={message.content}
                lesson={message.lesson}
                interactive={index === latestLessonIndex}
                activeStep={activeStep}
                locationLabel={locationLabel}
                files={files}
              />
            ) : (
              <ChatBubble key={`${message.createdAt}-${index}`} message={message} files={files} />
            ),
          )}
          {sending ? (
            <li className="flex items-center gap-2 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Pensando…
            </li>
          ) : null}
        </ol>
        {error ? (
          <div className="px-4 pb-4">
            <ErrorNote message={error} code={errorCode} onRetry={() => void submit()} />
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-line bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          canSubmit={!sending && draft.trim().length > 0}
          busy={sending}
          label="Pregunta de seguimiento"
          placeholder={`Pregunta algo más sobre ${session.nodeName}…`}
        />
      </form>
    </>
  );
}

interface LessonMessageProps {
  /** Texto del turno: el puente escrito por el chat, o el `overview` en las lecciones pedidas con el botón. */
  intro: string;
  lesson: Lesson;
  interactive: boolean;
  activeStep: number;
  locationLabel: (codeRef: LessonStep["codeRef"]) => string;
  files: ReadonlyMap<string, number> | null;
}

/** Una respuesta que es un recorrido guiado: texto + pasos sobre el código. */
function LessonMessage({ intro, lesson, interactive, activeStep, locationLabel, files }: LessonMessageProps) {
  const steps: TimelineStep[] = lesson.steps.map((step) => ({
    stepNumber: step.stepNumber,
    title: step.title,
    summary: step.summary,
    connectionReason: step.connectionReason,
    locationLabel: locationLabel(step.codeRef),
  }));
  const introIsOverview = intro.trim() === lesson.overview.trim();

  return (
    <li className="flex min-w-0 flex-col gap-2">
      {introIsOverview ? null : (
        <div className="min-w-0 max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink-2">
          <MarkdownAnswer source={intro} files={files} />
        </div>
      )}
      <section className="min-w-0 rounded-xl border border-teal-100 bg-teal-50/40 [overflow-wrap:anywhere]" aria-label={lesson.title}>
        <div className="px-4 pt-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Footprints className="size-4 shrink-0 text-teal-600" aria-hidden />
              {lesson.title}
            </h2>
            {interactive ? (
              <button
                type="button"
                aria-label="Cerrar lección"
                title="Cerrar lección"
                onClick={() => useLessonStore.getState().closeLesson()}
                className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-neutral-100 hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          {introIsOverview ? <p className="mt-1 text-sm leading-6 text-ink-2">{lesson.overview}</p> : null}
          {lesson.caveats.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {lesson.caveats.map((caveat, index) => (
                <li key={index} className="flex gap-2 text-sm text-ink-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                  {caveat}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {steps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">No hay un lugar en el código que responda a esto.</p>
        ) : interactive ? (
          <StepTimeline
            steps={steps}
            activeIndex={activeStep}
            onPrev={() => useLessonStore.getState().prev()}
            onNext={() => useLessonStore.getState().next()}
            onOpenInIde={(index) => useLessonStore.getState().goTo(index)}
          />
        ) : (
          <ol className="flex flex-col gap-1 px-4 py-3">
            {lesson.steps.map((step, index) => (
              <li key={index}>
                <button
                  type="button"
                  title={`Ver en el IDE: ${steps[index]?.locationLabel ?? ""}`}
                  onClick={() =>
                    syncEditorTo(
                      { filePath: step.codeRef.filePath, line: step.codeRef.startLine, endLine: step.codeRef.endLine },
                      { allowDeepLink: false },
                    )
                  }
                  className="w-full rounded-md px-1 py-0.5 text-left text-sm text-ink-2 hover:bg-white hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {step.title}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </li>
  );
}

function ChatBubble({ message, files }: { message: ChatMessage; files: ReadonlyMap<string, number> | null }) {
  const mine = message.role === "user";
  return (
    <li className={cn("flex min-w-0", mine ? "justify-end" : "justify-start")}>
      {mine ? (
        <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-100 px-3 py-2 text-sm leading-6 text-ink [overflow-wrap:anywhere]">
          {message.content}
        </p>
      ) : (
        <div className="min-w-0 max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink-2">
          <MarkdownAnswer source={message.content} files={files} />
          {message.evidence === "missing" || message.evidence === "not-in-map" ? <EvidenceNote evidence={message.evidence} /> : null}
        </div>
      )}
    </li>
  );
}

/** Aviso bajo una respuesta sin respaldo en el mapa (ver `lib/evidence.ts`). */
function EvidenceNote({ evidence }: { evidence: "missing" | "not-in-map" }) {
  if (evidence === "not-in-map") {
    return (
      <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-xs text-ink-3">
        <MapPinOff className="size-3.5 shrink-0" aria-hidden />
        No aparece en el mapa del proyecto.
      </p>
    );
  }
  return (
    <p role="note" className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Sin evidencia en el mapa.</strong> Esta respuesta habla del proyecto sin citar código que exista en el
        mapa: contrástala antes de fiarte.
      </span>
    </p>
  );
}

function OpenSettingsButton() {
  return (
    <Link href={DASHBOARD_ROUTES.api} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline">
      <Settings className="size-3.5" aria-hidden />
      Abrir API & Integración
    </Link>
  );
}

function ErrorNote({ message, code, onRetry }: { message: string; code: string | null; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <p className="[overflow-wrap:anywhere]">{message}</p>
      <div className="flex flex-wrap gap-x-4">
        {code && SETTINGS_ERRORS.has(code) ? <OpenSettingsButton /> : null}
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium underline">
          Reintentar
        </button>
      </div>
    </div>
  );
}
