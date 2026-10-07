"use client";

import { useTeacherCommand, useTeacherIdeState } from "@/hooks/useTeacherSocket";
import { buildClear, buildNavigate } from "@/lib/protocol";

function HighlightButtons() {
  const { status, send } = useTeacherCommand();
  const disabled = status !== "open";

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => send(buildNavigate("src/rag/vector_store.py", 14, 45))}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Highlight RAG Code
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => send(buildNavigate("src/db/database.py", 10, 30))}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Highlight DB Code
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => send(buildClear())}
        className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Clear highlights
      </button>
    </div>
  );
}

function IdeStateReadout() {
  const ideState = useTeacherIdeState();

  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-y-1 font-mono text-sm text-ink-2">
      <dt>activeFile</dt>
      <dd>{ideState?.activeFile ?? "—"}</dd>
      <dt>cursorLine</dt>
      <dd>{ideState?.cursorLine ?? "—"}</dd>
      <dt>status</dt>
      <dd>{ideState?.status ?? "—"}</dd>
    </dl>
  );
}

export function BridgeTestPanel() {
  return (
    <section className="flex flex-col gap-6 rounded-xl border border-line bg-white p-6">
      <HighlightButtons />
      <IdeStateReadout />
    </section>
  );
}
