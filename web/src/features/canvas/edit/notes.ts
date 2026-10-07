/**
 * Notas de arquitectura por nodo (decisiones, riesgos, comentarios). Viven en el estado de proyecto del
 * pipeline (`useCanvasEdits`), no en el código: funciones puras para validar, añadir y quitar.
 */

export type NoteKind = "note" | "decision" | "risk";

export const NOTE_KINDS: readonly NoteKind[] = ["note", "decision", "risk"];

export const NOTE_KIND_LABEL: Readonly<Record<NoteKind, string>> = {
  note: "Nota",
  decision: "Decisión",
  risk: "Riesgo",
};

export interface NodeNote {
  id: string;
  kind: NoteKind;
  text: string;
  /** ISO 8601. */
  createdAt: string;
}

export type NotesByNode = Readonly<Record<string, readonly NodeNote[]>>;

export const MAX_NOTE_CHARS = 2000;
export const MAX_NOTES_PER_NODE = 50;

function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === "string" && (NOTE_KINDS as readonly string[]).includes(value);
}

function readNote(value: unknown): NodeNote | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 64) return null;
  if (typeof record.text !== "string" || record.text.trim().length === 0) return null;
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) return null;
  return {
    id: record.id,
    kind: isNoteKind(record.kind) ? record.kind : "note",
    text: record.text.slice(0, MAX_NOTE_CHARS),
    createdAt: record.createdAt,
  };
}

/** Lo leído de localStorage: se descarta lo que no cumple el contrato, nunca rompe el lienzo. */
export function sanitizeNotes(value: unknown): NotesByNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const notes: Record<string, NodeNote[]> = {};
  for (const [nodeId, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const valid = list.map(readNote).filter((note): note is NodeNote => note !== null).slice(0, MAX_NOTES_PER_NODE);
    if (valid.length > 0) notes[nodeId] = valid;
  }
  return notes;
}

/** Añade una nota (texto recortado); null si está vacía o el nodo ya tiene el máximo. */
export function addNote(notes: NotesByNode, nodeId: string, note: NodeNote): { notes: NotesByNode; note: NodeNote } | null {
  const text = note.text.trim().slice(0, MAX_NOTE_CHARS);
  const current = notes[nodeId] ?? [];
  if (!text || current.length >= MAX_NOTES_PER_NODE) return null;
  const added: NodeNote = { ...note, text };
  return { notes: { ...notes, [nodeId]: [...current, added] }, note: added };
}

export function removeNote(notes: NotesByNode, nodeId: string, noteId: string): NotesByNode {
  const remaining = (notes[nodeId] ?? []).filter((note) => note.id !== noteId);
  const next: Record<string, readonly NodeNote[]> = { ...notes };
  if (remaining.length > 0) next[nodeId] = remaining;
  else delete next[nodeId];
  return next;
}

/** Notas como sección Markdown (para ARCHITECTURE.md). */
export function notesMarkdown(notes: NotesByNode, labelOf: (nodeId: string) => string): string {
  const entries = Object.entries(notes).filter(([, list]) => list.length > 0);
  if (entries.length === 0) return "";
  const lines = ["## Notas de arquitectura", ""];
  for (const [nodeId, list] of entries.sort(([left], [right]) => labelOf(left).localeCompare(labelOf(right)))) {
    lines.push(`### ${labelOf(nodeId)}`, "");
    for (const note of list) lines.push(`- **${NOTE_KIND_LABEL[note.kind]}** (${note.createdAt.slice(0, 10)}): ${note.text.replace(/\s+/g, " ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
