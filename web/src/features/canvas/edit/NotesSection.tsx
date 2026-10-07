"use client";

import { useId, useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_NOTE_CHARS, NOTE_KINDS, NOTE_KIND_LABEL, type NoteKind } from "./notes";
import { useCanvasEdits } from "./store";

const KIND_TONE: Readonly<Record<NoteKind, string>> = {
  note: "bg-yellow-100 text-yellow-800",
  decision: "bg-sky-100 text-sky-800",
  risk: "bg-rose-100 text-rose-800",
};

const EMPTY: readonly never[] = [];

/**
 * Notas de arquitectura del nodo (clic derecho): se guardan con el estado del proyecto del pipeline y
 * salen en ARCHITECTURE.md al exportar.
 */
export function NotesSection({ nodeId, sectionClassName }: { nodeId: string; sectionClassName: string }) {
  const notes = useCanvasEdits((state) => state.notes[nodeId] ?? EMPTY);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const inputId = useId();
  const canSave = text.trim().length > 0;

  function save(): void {
    if (!canSave) return;
    if (useCanvasEdits.getState().addNote(nodeId, text, kind)) setText("");
  }

  return (
    <section aria-label="Notas de arquitectura" className="border-t border-line">
      <p className={sectionClassName}>
        <StickyNote className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        Notas de arquitectura{notes.length > 0 ? ` (${notes.length})` : ""}
      </p>
      {notes.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto px-2 pb-1">
          {notes.map((note) => (
            <li key={note.id} className="group/note flex items-start gap-1.5 rounded-md bg-neutral-50 px-2 py-1.5 text-xs">
              <span className={cn("shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold", KIND_TONE[note.kind])}>{NOTE_KIND_LABEL[note.kind]}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]" title={new Date(note.createdAt).toLocaleString("es")}>
                {note.text}
              </span>
              <button
                type="button"
                aria-label="Borrar nota"
                title="Borrar nota"
                onClick={() => useCanvasEdits.getState().removeNote(nodeId, note.id)}
                className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-1.5 px-2 pb-2">
        <label htmlFor={inputId} className="sr-only">
          Nueva nota
        </label>
        <textarea
          id={inputId}
          rows={2}
          value={text}
          maxLength={MAX_NOTE_CHARS}
          placeholder="Añade una nota, decisión o riesgo…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter + Ctrl/⌘ guarda; Escape lo gestiona el menú (cierra).
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          className="min-h-12 resize-y rounded-md border border-line px-2 py-1 text-xs text-ink focus:border-teal-400 focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Tipo de nota"
            value={kind}
            onChange={(event) => setKind(event.target.value as NoteKind)}
            className="h-7 rounded-md border border-line bg-white px-1.5 text-xs text-ink focus:border-teal-400 focus:outline-none"
          >
            {NOTE_KINDS.map((item) => (
              <option key={item} value={item}>
                {NOTE_KIND_LABEL[item]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            title="Ctrl + Enter"
            className="ml-auto h-7 rounded-md bg-ink px-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            Guardar nota
          </button>
        </div>
      </div>
    </section>
  );
}
