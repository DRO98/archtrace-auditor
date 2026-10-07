"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, History, MessagesSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { IdeSetupButton } from "@/features/canvas/components/IdeSetupButton";
import { ModuleIcon } from "@/features/canvas/nodes/ModuleIcon";
import { ROLE_LABEL, ROLE_TONE } from "@/features/canvas/theme";
import { useCanvasStore } from "@/features/canvas/store";
import { sessionNodeFrom, type SessionNode } from "./lib/sessionNode";
import { groupSessions, moduleKey, type ModuleGroup } from "./lib/sessionStorage";
import { useLessonStore } from "@/features/lesson/store";
import { ModuleSessionList } from "./ModuleSessionList";
import { formatRelative, sessionExcerpt } from "./lib/format";

/** Una tarjeta por módulo; al pulsarla se elige una de sus conversaciones. */
export function HistoryView() {
  const sessions = useLessonStore((state) => state.sessions);
  const projectName = useCanvasStore((state) => state.graph?.projectName);
  const [focus, setFocus] = useState<{ key: string; node: SessionNode } | null>(null);

  useEffect(() => {
    useLessonStore.getState().loadSessions();
  }, [projectName]);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const moduleSessions = focus ? sessions.filter((session) => moduleKey(session.nodeId) === focus.key) : [];

  return (
    <div className="absolute inset-0 bg-canvas">
      <div className="absolute inset-0 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {focus ? (
            <ModuleSessionList
              node={focus.node}
              sessions={moduleSessions}
              onBack={() => setFocus(null)}
              onNew={() => useLessonStore.getState().startBlank(focus.node)}
            />
          ) : (
            <>
              <header className="mb-6 flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-lg font-semibold text-ink">Historial de lecciones</h1>
                  <p className="text-sm text-ink-2">Elige un módulo para ver sus conversaciones.</p>
                </div>
                {groups.length > 0 ? (
                  <span className="text-xs text-ink-3">
                    {groups.length} {groups.length === 1 ? "módulo" : "módulos"}
                  </span>
                ) : null}
              </header>

              {groups.length === 0 ? (
                <EmptyState />
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                  {groups.map((group) => (
                    <li key={group.moduleKey}>
                      <ModuleCard
                        group={group}
                        onOpen={() => setFocus({ key: group.moduleKey, node: sessionNodeFrom(group.latest) })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg border border-line bg-white/90 px-3 py-1.5 font-mono text-[11px] text-ink-2 shadow-md backdrop-blur">
        <IdeSetupButton />
      </div>
    </div>
  );
}

function ModuleCard({ group, onOpen }: { group: ModuleGroup; onOpen: () => void }) {
  const session = group.latest;
  const tone = ROLE_TONE[session.nodeRole] ?? ROLE_TONE.code;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-xl border bg-white shadow-md transition-shadow duration-150 hover:shadow-lg",
        tone.border,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: tone.hex }}
      />
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <div className="flex items-center gap-3 px-4 pt-4">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", tone.tile)} aria-hidden>
            <ModuleIcon role={session.nodeRole} filePath={session.filePath ?? ""} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold leading-5 text-ink">{session.nodeName}</h2>
            <p className="truncate font-mono text-[11px] leading-4 text-ink-3">
              {session.filePath ?? "Proyecto completo"}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", tone.tile)}>
            {ROLE_LABEL[session.nodeRole] ?? "Código"}
          </span>
        </div>
        <p className="mx-4 mt-3 line-clamp-2 flex-1 text-sm leading-5 text-ink-2">{sessionExcerpt(session)}</p>
      </button>

      <footer className="mt-4 flex items-center gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1" title="Conversaciones">
          <MessagesSquare className="size-3.5" aria-hidden />
          {group.count}
        </span>
        <time dateTime={new Date(session.timestamp).toISOString()}>{formatRelative(session.timestamp)}</time>
        <button
          type="button"
          aria-label={`Borrar las conversaciones de ${session.nodeName}`}
          title="Borrar módulo"
          onClick={() => {
            useLessonStore.getState().deleteModuleSessions(session.nodeId);
          }}
          className="ml-auto grid size-7 place-items-center rounded-md opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-700 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-ink hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Ver conversaciones
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </footer>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-white px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-neutral-100 text-ink-2" aria-hidden>
        <History className="size-5" />
      </span>
      <h2 className="text-sm font-semibold text-ink">Todavía no hay lecciones</h2>
      <p className="max-w-sm text-sm text-ink-2">
        Abre un componente en Arquitectura y pulsa <BookOpen className="inline size-3.5" aria-hidden />{" "}
        «Ver explicación» para crear la primera.
      </p>
      <button
        type="button"
        onClick={() => useCanvasStore.getState().setView("architecture")}
        className="mt-1 inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-neutral-50"
      >
        Ir a Arquitectura
      </button>
    </div>
  );
}
