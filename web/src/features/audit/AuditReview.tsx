"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Code2, Eye, FileText, Flag, ShieldAlert, X } from "lucide-react";
import { CRITICALITIES, type DiffSide, type Finding, type ReviewStatus } from "@core/audit";
import { buildEditorDeepLink, readEditorScheme } from "@/features/canvas/lib/editorLink";
import { readIdeSetup } from "@/features/canvas/lib/ideSetup";
import { Badge, BTN_GHOST, BTN_SECONDARY } from "@/features/dashboard/ui";
import { sendTeacherMessage, useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import { buildNavigate } from "@/lib/protocol";
import { CRITICALITY_LABEL, CRITICALITY_TONE, keyToAction, monacoLanguage, REVIEW_LABEL, reviewQueue, type ReviewFilter } from "./lib/review";
import { AUDIT_BASE_PATH } from "./routes";
import { fileKey, useAuditStore } from "./store";

const DiffViewer = dynamic(() => import("./components/DiffViewer").then((module) => module.DiffViewer), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-fg-3">Cargando visor…</p>,
});

const ORIGIN_LABEL = { rule: "regla", llm: "LLM", both: "regla + LLM", none: "—" } as const;

const ACTIONS: ReadonlyArray<{ status: ReviewStatus; label: string; key: string; icon: typeof Check }> = [
  { status: "reviewed", label: "Revisado", key: "v", icon: Eye },
  { status: "accepted", label: "Aceptar", key: "a", icon: Check },
  { status: "rejected", label: "Rechazar", key: "r", icon: X },
  { status: "false_positive", label: "Falso positivo", key: "f", icon: Flag },
];

const ENV_SCHEME = readEditorScheme(process.env.NEXT_PUBLIC_EDITOR_SCHEME);

/** `/dashboard/audit/[id]`: cola ordenada, diff con resaltado por criticidad, evidencias y revisión persistida. */
export function AuditReview({ repoId, auditId }: { repoId: string; auditId: string }) {
  const { run, busy, error, filter, selectedId, files } = useAuditStore();
  const openAudit = useAuditStore((s) => s.openAudit);
  const setFilter = useAuditStore((s) => s.setFilter);
  const select = useAuditStore((s) => s.select);
  const move = useAuditStore((s) => s.move);
  const setReview = useAuditStore((s) => s.setReview);
  const loadFile = useAuditStore((s) => s.loadFile);
  const clearError = useAuditStore((s) => s.clearError);
  const ideOnline = useTeacherStatus() === "open";
  const [focusState, setFocus] = useState<{ findingId: string; side: DiffSide; line: number; nonce: number } | null>(null);

  useEffect(() => {
    void openAudit(repoId, auditId);
  }, [openAudit, repoId, auditId]);

  const queue = useMemo(() => (run ? reviewQueue(run.findings, filter) : []), [run, filter]);
  const finding = run?.findings.find((item) => item.id === selectedId) ?? null;
  const unit = finding ? run?.units.find((item) => item.id === finding.unitId) : undefined;
  const basePath = unit?.previousPath ?? finding?.file ?? "";
  const focus = focusState && focusState.findingId === finding?.id ? focusState : null;

  useEffect(() => {
    if (!finding) return;
    void loadFile("base", basePath);
    void loadFile("head", finding.file);
  }, [finding, basePath, loadFile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const action = keyToAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action.kind === "move") move(action.delta);
      else void setReview(action.status);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, setReview]);

  if (!run) {
    return (
      <div className="theme-light grid h-full place-items-center bg-app p-8 text-sm text-fg-2">
        {busy === "loading" ? "Cargando auditoría…" : error ? <span className="text-rose-700">{error}</span> : "Auditoría no encontrada."}
      </div>
    );
  }

  const reviewed = run.findings.filter((item) => item.review.status !== "pending").length;
  const original = finding ? files[fileKey(run.id, "base", basePath)] : undefined;
  const modified = finding ? files[fileKey(run.id, "head", finding.file)] : undefined;

  function openInEditor(file: string, line: number, endLine = line) {
    if (sendTeacherMessage(buildNavigate(file, line, endLine, { focusEditor: true }))) return;
    const saved = readIdeSetup();
    const href = buildEditorDeepLink(run!.repo.root, { filePath: file, line }, saved?.ide ?? ENV_SCHEME);
    if (href) window.location.href = href;
  }

  return (
    <div className="theme-light flex h-full min-h-0 flex-col bg-app text-fg">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-panel px-4 py-3">
        <Link href={AUDIT_BASE_PATH} className={cn(BTN_GHOST, "h-8 px-2")} aria-label="Volver a auditorías">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {run.repo.name} · <span className="font-mono">{run.base}</span> → <span className="font-mono">{run.head}</span>
          </h1>
          <p className="truncate text-xs text-fg-3">
            {run.id}
            {run.taskId ? ` · tarea ${run.taskId}` : ""} · {run.llm ? `${run.llm.provider}/${run.llm.model}` : "solo reglas"}
            {run.llm ? ` · reglas por ${run.metrics.retrieval?.mode === "hybrid" ? "RAG híbrido" : "BM25"}` : ""} · {run.metrics.tokensIn + run.metrics.tokensOut} tokens ·{" "}
            {run.metrics.linesPrioritized}/{run.metrics.linesTotal} líneas priorizadas
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por criticidad">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            Todos {run.findings.length}
          </FilterChip>
          <FilterChip active={filter === "pending"} onClick={() => setFilter("pending")}>
            Pendientes {run.findings.length - reviewed}
          </FilterChip>
          {CRITICALITIES.map((criticality) => (
            <FilterChip key={criticality} active={filter === criticality} onClick={() => setFilter(criticality as ReviewFilter)} tone={criticality}>
              {CRITICALITY_LABEL[criticality]} {run.summary[criticality]}
            </FilterChip>
          ))}
        </div>
        <span className="ml-auto text-xs text-fg-3">
          Revisados {reviewed}/{run.findings.length} · atajos j/k, a/r/f/v
        </span>
      </header>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" className="text-xs underline" onClick={clearError}>
            Cerrar
          </button>
        </div>
      ) : null}
      {run.warnings.length > 0 ? (
        <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-800">{run.warnings.join(" · ")}</p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]">
        <nav aria-label="Cola de hallazgos" className="scrollbar-thin min-h-0 overflow-y-auto border-r border-edge bg-panel">
          <ul>
            {queue.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => select(item.id)}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-edge px-3 py-2 text-left hover:bg-app-2",
                    item.id === selectedId && "bg-brand/10 hover:bg-brand/10",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{item.id}</span>
                    <Badge tone={CRITICALITY_TONE[item.criticality]}>{CRITICALITY_LABEL[item.criticality]}</Badge>
                    <span className="ml-auto text-[11px] text-fg-3">{REVIEW_LABEL[item.review.status]}</span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-fg-2">
                    {item.file}
                    {item.symbol ? ` · ${item.symbol}` : ""}
                  </span>
                </button>
              </li>
            ))}
            {queue.length === 0 ? <li className="px-3 py-4 text-sm text-fg-3">Nada con este filtro.</li> : null}
          </ul>
        </nav>

        <section aria-label="Diff" className="flex min-h-0 flex-col">
          {finding ? (
            <>
              <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2 text-xs">
                <FileText className="size-3.5 text-fg-3" aria-hidden />
                <span className="truncate font-mono">
                  {unit?.previousPath ? `${unit.previousPath} → ` : ""}
                  {finding.file}
                </span>
                <span className="text-fg-3">
                  L{finding.lines.startLine}–L{finding.lines.endLine} ({finding.side === "base" ? "base" : "head"})
                </span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className={cn(BTN_GHOST, "h-7 px-2 text-xs")} onClick={() => move(-1)} aria-label="Anterior (k)">
                    <ChevronUp className="size-4" aria-hidden />
                  </button>
                  <button type="button" className={cn(BTN_GHOST, "h-7 px-2 text-xs")} onClick={() => move(1)} aria-label="Siguiente (j)">
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={cn(BTN_SECONDARY, "h-7 px-2 text-xs")}
                    onClick={() => openInEditor(finding.file, finding.lines.startLine, finding.lines.endLine)}
                    title={ideOnline ? "Abrir en el IDE (extensión conectada)" : "Abrir con enlace del editor"}
                  >
                    <Code2 className="size-3.5" aria-hidden /> Abrir en VS Code
                  </button>
                </span>
              </div>
              <div className="min-h-0 flex-1">
                {original === undefined || modified === undefined ? (
                  <p className="p-4 text-sm text-fg-3">Cargando archivo…</p>
                ) : (
                  <DiffViewer
                    original={original}
                    modified={modified}
                    language={monacoLanguage(finding.file)}
                    modelKey={`${run.id}/${finding.file}`}
                    finding={finding}
                    focus={focus}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="p-6 text-sm text-fg-3">Sin hallazgos.</p>
          )}
        </section>

        <aside aria-label="Detalle del hallazgo" className="scrollbar-thin min-h-0 overflow-y-auto border-l border-edge bg-panel">
          {finding ? (
            <FindingPanel
              key={finding.id}
              finding={finding}
              onReview={(status, note) => void setReview(status, note)}
              onEvidence={(side, line) => setFocus({ findingId: finding.id, side, line, nonce: Date.now() })}
              onOpenRule={(file, line) => openInEditor(file, line)}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, tone, children }: { active: boolean; onClick: () => void; tone?: keyof typeof CRITICALITY_TONE; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-6 rounded-md border px-2 text-[11px] font-medium transition-colors",
        active ? "border-brand bg-brand/10 text-brand-strong" : "border-edge text-fg-2 hover:bg-app-2",
        tone === "critical" && !active && "text-rose-700",
      )}
    >
      {children}
    </button>
  );
}

/** Se remonta por hallazgo (`key`): la nota empieza con la guardada. */
function FindingPanel({
  finding,
  onReview,
  onEvidence,
  onOpenRule,
}: {
  finding: Finding;
  onReview: (status: ReviewStatus, note: string) => void;
  onEvidence: (side: DiffSide, line: number) => void;
  onOpenRule: (file: string, line: number) => void;
}) {
  const semantic = finding.semantic;
  const [note, setNote] = useState(finding.review.note ?? "");
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{finding.id}</span>
        <Badge tone={CRITICALITY_TONE[finding.criticality]}>{CRITICALITY_LABEL[finding.criticality]}</Badge>
        <Badge tone="neutral">{finding.category}</Badge>
        {finding.humanReviewRequired ? (
          <Badge tone="amber">
            <ShieldAlert className="size-3" aria-hidden /> revisión humana
          </Badge>
        ) : null}
      </div>
      <p className="text-fg">{finding.reason}</p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <dt className="text-fg-3">Confianza</dt>
        <dd className="font-mono">{finding.confidence.toFixed(2)}</dd>
        <dt className="text-fg-3">Origen</dt>
        <dd>
          cat. {ORIGIN_LABEL[finding.origin.category]} · crit. {ORIGIN_LABEL[finding.origin.criticality]}
        </dd>
        <dt className="text-fg-3">Contexto</dt>
        <dd>{finding.contextLevel < 0 ? "sin LLM" : `L${finding.contextLevel}`}</dd>
        {semantic ? (
          <>
            <dt className="text-fg-3">LLM</dt>
            <dd className="font-mono">
              {semantic.usage ? `${semantic.usage.promptTokens}/${semantic.usage.completionTokens} tok` : "—"}
              {semantic.cached ? " · caché" : ""}
            </dd>
          </>
        ) : null}
        {semantic && (semantic.dropped.evidence > 0 || semantic.dropped.ruleRefs > 0 || semantic.dropped.invalidCategory) ? (
          <>
            <dt className="text-fg-3">Descartado</dt>
            <dd>
              {[
                semantic.dropped.evidence ? `${semantic.dropped.evidence} evidencias` : null,
                semantic.dropped.ruleRefs ? `${semantic.dropped.ruleRefs} reglas` : null,
                semantic.dropped.invalidCategory ? "categoría" : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </>
        ) : null}
      </dl>

      {finding.evidence.length > 0 ? (
        <section>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-3">Evidencias</h2>
          <ul className="space-y-1">
            {finding.evidence.map((item) => (
              <li key={`${item.side}:${item.line}`}>
                <button type="button" className="w-full rounded-md bg-app-2 px-2 py-1 text-left hover:bg-panel-2" onClick={() => onEvidence(item.side, item.line)}>
                  <span className="text-[11px] text-fg-3">
                    L{item.line} · {item.side} · {item.source === "llm" ? "LLM" : "regla"}
                  </span>
                  <code className="block truncate font-mono text-xs">{item.text}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finding.rules.length > 0 ? (
        <section>
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-3">Reglas del repo</h2>
          <ul className="space-y-2">
            {finding.rules.map((rule) => (
              <li key={rule.sectionId} className="rounded-md border border-edge p-2">
                <button type="button" className="font-mono text-xs text-brand-soft underline" onClick={() => onOpenRule(rule.file, rule.lines.startLine)}>
                  {rule.sectionId}
                </button>
                {rule.critical ? (
                  <Badge tone="rose" className="ml-2">
                    crítica
                  </Badge>
                ) : null}
                <p className="mt-1 text-xs text-fg-2">«{rule.excerpt}»</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finding.signals.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-fg-3">Señales ({finding.signals.length})</summary>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {finding.signals.map((signal, index) => (
              <li key={`${signal.detector}:${signal.line}:${index}`} className="font-mono text-fg-2">
                {signal.token} · {signal.detector} · {signal.line > 0 ? `L${signal.line}` : "ruta"} · {signal.strength === "strong" ? "fuerte" : "débil"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {finding.relatedTests.length > 0 ? (
        <p className="text-xs text-fg-2">
          Tests relacionados: <span className="font-mono">{finding.relatedTests.join(", ")}</span>
        </p>
      ) : null}

      <section className="space-y-2 border-t border-edge pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-3">Revisión · {REVIEW_LABEL[finding.review.status]}</h2>
        <textarea
          className="h-20 w-full rounded-lg border border-edge bg-panel p-2 text-xs focus:border-brand focus:outline-none"
          placeholder="Nota (opcional) · Esc para volver a los atajos"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          // Esc devuelve el foco a la página: vuelven los atajos j/k/a/r/f/v.
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map(({ status, label, key, icon: Icon }) => (
            <button
              key={status}
              type="button"
              onClick={() => onReview(status, note)}
              aria-pressed={finding.review.status === status}
              className={cn(BTN_SECONDARY, "h-8 text-xs", finding.review.status === status && "border-brand bg-brand/10 text-brand-strong")}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
              <kbd className="ml-auto rounded border border-edge px-1 font-mono text-[10px] text-fg-3">{key}</kbd>
            </button>
          ))}
        </div>
        {finding.review.updatedAt ? <p className="text-[11px] text-fg-3">Guardado en Auditoria.md · {new Date(finding.review.updatedAt).toLocaleString()}</p> : null}
      </section>
    </div>
  );
}
