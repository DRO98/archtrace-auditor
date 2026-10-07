"use client";

import { useEffect, useId } from "react";
import { GitCompare, Loader2, X } from "lucide-react";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import { diffCounts } from "./lib/gitDiff";
import { useGitDiff } from "./store";

const FIELD = "h-8 min-w-0 flex-1 rounded-md border border-line bg-white px-2 font-mono text-xs text-ink focus:border-teal-400 focus:outline-none";
const WORKING_TREE = "__working_tree__";

const LEGEND = [
  { key: "added", label: "Añadidos", dot: "bg-emerald-500" },
  { key: "modified", label: "Modificados", dot: "bg-amber-400" },
  { key: "deleted", label: "Eliminados", dot: "bg-rose-500" },
] as const;

/**
 * Diff visual de git sobre el lienzo: elige base y destino (rama, commit o el árbol de trabajo) y los nodos
 * cambiados se resaltan en verde, amarillo o rojo. Git se ejecuta en la extensión del IDE.
 */
export function DiffPanel() {
  const status = useTeacherStatus();
  const { active, loading, error, refs, base, head, diff } = useGitDiff();
  const baseId = useId();
  const headId = useId();
  const connected = status === "open";

  useEffect(() => {
    if (connected && !useGitDiff.getState().refs) void useGitDiff.getState().loadRefs();
  }, [connected]);

  const counts = diff ? diffCounts(diff) : null;
  const options = [
    ...(refs?.current ? [{ value: refs.current, label: `${refs.current} (actual)` }] : []),
    { value: "HEAD", label: "HEAD (último commit)" },
    ...(refs?.branches ?? []).filter((name) => name !== refs?.current).map((name) => ({ value: name, label: name })),
    ...(refs?.commits ?? []).map((commit) => ({ value: commit.sha, label: `${commit.sha.slice(0, 7)} · ${commit.subject.slice(0, 48)}` })),
  ];

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 p-3">
      {!connected ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          Conecta el IDE (extensión ArchTrace): git se consulta en tu workspace.
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor={baseId} className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Base
        </label>
        <select id={baseId} className={FIELD} value={base} disabled={!connected || loading} onChange={(event) => useGitDiff.getState().setBase(event.target.value)}>
          {options.some((option) => option.value === base) ? null : <option value={base}>{base}</option>}
          {options.map((option) => (
            <option key={`b:${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={headId} className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Comparar con
        </label>
        <select
          id={headId}
          className={FIELD}
          value={head ?? WORKING_TREE}
          disabled={!connected || loading}
          onChange={(event) => useGitDiff.getState().setHead(event.target.value === WORKING_TREE ? null : event.target.value)}
        >
          <option value={WORKING_TREE}>Árbol de trabajo (incluye cambios sin commitear)</option>
          {options.map((option) => (
            <option key={`h:${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!connected || loading}
          onClick={() => void useGitDiff.getState().compare()}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GitCompare className="size-4" aria-hidden />}
          {active ? "Actualizar diff" : "Mostrar diff"}
        </button>
        {active ? (
          <button
            type="button"
            onClick={() => useGitDiff.getState().clear()}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-sm text-ink-2 hover:bg-neutral-50"
          >
            <X className="size-3.5" aria-hidden />
            Quitar
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-rose-700 [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
      {active && counts && diff ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Leyenda del diff">
            {LEGEND.map((item) => (
              <li key={item.key} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-full", item.dot)} aria-hidden />
                {item.label}: <span className="font-semibold text-ink">{counts[item.key]}</span>
              </li>
            ))}
          </ul>
          {diff.deletedOutside.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-rose-700">{diff.deletedOutside.length} eliminados sin nodo en el lienzo</summary>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-[11px] text-ink-2">
                {diff.deletedOutside.map((path) => (
                  <li key={path} className="truncate" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {diff.changedOutside.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-2">{diff.changedOutside.length} archivos cambiados fuera del lienzo</summary>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-[11px] text-ink-2">
                {diff.changedOutside.map((path) => (
                  <li key={path} className="truncate" title={path}>
                    {path}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
