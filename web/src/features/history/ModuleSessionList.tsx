"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ModuleIcon } from "@/features/canvas/nodes/ModuleIcon";
import { ROLE_LABEL, ROLE_TONE } from "@/features/canvas/theme";
import type { SessionNode } from "@/features/history/lib/sessionNode";
import { useLessonStore } from "@/features/lesson/store";
import { formatRelative, sessionExcerpt } from "./lib/format";
import type { LessonSession } from "./types";

const PRIMARY_BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-lg bg-linear-to-b from-primary to-primary-strong px-3.5 text-sm font-medium text-white shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function ModuleSessionList({
  node,
  sessions,
  onBack,
  onNew,
}: {
  node: SessionNode;
  sessions: readonly LessonSession[];
  onBack: () => void;
  onNew: () => void;
}) {
  const tone = ROLE_TONE[node.nodeRole] ?? ROLE_TONE.code;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const beginRename = (session: LessonSession) => {
    setEditingId(session.id);
    setDraft(session.title);
  };

  const commitRename = () => {
    if (editingId) useLessonStore.getState().renameSession(editingId, draft);
    setEditingId(null);
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex h-8 items-center gap-1 rounded-md px-1 text-sm text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Volver
          </button>
          <div className="flex items-center gap-3">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", tone.tile)} aria-hidden>
              <ModuleIcon role={node.nodeRole} filePath={node.filePath ?? ""} className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-ink">{node.nodeName}</h1>
              <p className="truncate font-mono text-[11px] text-ink-3">{node.filePath ?? "Proyecto completo"}</p>
            </div>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", tone.tile)}>
              {ROLE_LABEL[node.nodeRole] ?? "Código"}
            </span>
          </div>
        </div>
        <button type="button" onClick={onNew} className={PRIMARY_BUTTON}>
          <Plus className="size-4" aria-hidden />
          Nuevo hilo de módulo
        </button>
      </header>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-white px-6 py-12 text-center text-sm text-ink-2">
          No quedan conversaciones en este módulo.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id}>
              <SessionRow
                session={session}
                editing={editingId === session.id}
                draft={draft}
                onDraft={setDraft}
                onBeginRename={() => beginRename(session)}
                onCommitRename={commitRename}
                onCancelRename={() => setEditingId(null)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionRow({
  session,
  editing,
  draft,
  onDraft,
  onBeginRename,
  onCommitRename,
  onCancelRename,
}: {
  session: LessonSession;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}) {
  return (
    <article className="rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onCommitRename();
          }}
        >
          <input
            autoFocus
            aria-label="Nuevo título"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelRename();
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-ink px-3 text-sm font-medium text-white disabled:opacity-40"
          >
            <Check className="size-3.5" aria-hidden />
            Guardar
          </button>
        </form>
      ) : (
        <h2 className="truncate text-[15px] font-semibold text-ink">{session.title}</h2>
      )}
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-ink-2">{sessionExcerpt(session)}</p>
      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1" title="Mensajes">
          <MessagesSquare className="size-3.5" aria-hidden />
          {session.history.length}
        </span>
        <time dateTime={new Date(session.timestamp).toISOString()}>{formatRelative(session.timestamp)}</time>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onBeginRename}
            disabled={editing}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-ink hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <Pencil className="size-3.5" aria-hidden />
            Renombrar
          </button>
          <button
            type="button"
            onClick={() => useLessonStore.getState().deleteSession(session.id)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-ink hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Eliminar sesión
          </button>
          <button
            type="button"
            onClick={() => useLessonStore.getState().openSession(session.id)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-ink hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Continuar conversación
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </footer>
    </article>
  );
}
