"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { FolderGit2, History, Play, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { CRITICALITIES, type AuditMode } from "@core/audit";
import { PageShell } from "@/features/dashboard/PageShell";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, FIELD, Panel, PanelHeader } from "@/features/dashboard/ui";
import { providerLabel } from "@/lib/ai/catalog";
import { modelFor, useAiSettings } from "@/lib/ai/settings";
import { AUDITOR_URL } from "@/lib/auditor/client";
import { cn } from "@/lib/cn";
import { auditHref } from "./routes";
import { CRITICALITY_LABEL, CRITICALITY_TONE } from "./lib/review";
import { useAuditStore, type LlmSource } from "./store";

const MODES: ReadonlyArray<{ id: AuditMode; label: string; hint: string }> = [
  { id: "commit", label: "Último commit", hint: "Un commit frente a su padre (por defecto HEAD)." },
  { id: "worktree", label: "Sin commitear", hint: "HEAD frente al árbol de trabajo, incluidos archivos nuevos." },
  { id: "branch", label: "Rama", hint: "Lo que añadió la rama actual desde su merge-base con la base." },
  { id: "range", label: "Rango", hint: "Dos refs cualesquiera: base → head." },
];

/** `/dashboard/audit`: vincular un repo local, lanzar una auditoría y ver el historial. */
export function AuditHome() {
  const router = useRouter();
  const formId = useId();
  const { online, health, repos, repoId, refs, audits, busy, error } = useAuditStore();
  const init = useAuditStore((s) => s.init);
  const linkRepo = useAuditStore((s) => s.linkRepo);
  const unlinkRepo = useAuditStore((s) => s.unlinkRepo);
  const selectRepo = useAuditStore((s) => s.selectRepo);
  const startAudit = useAuditStore((s) => s.startAudit);
  const clearError = useAuditStore((s) => s.clearError);
  const aiProvider = useAiSettings((s) => s.provider);
  const aiModel = useAiSettings((s) => (s.provider ? modelFor(s, s.provider) : null));

  const [path, setPath] = useState("");
  const [mode, setMode] = useState<AuditMode>("commit");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [taskId, setTaskId] = useState("");
  const [planPath, setPlanPath] = useState("");
  // null = por defecto: la bóveda del navegador si hay proveedor elegido; si no, las claves del auditor.
  const [llmChoice, setLlmChoice] = useState<LlmSource | null>(null);
  const envProvider = health?.envProvider ?? null;
  const available: Record<LlmSource, boolean> = { vault: aiProvider !== null, env: envProvider !== null, off: true };
  const fallback: LlmSource = aiProvider !== null ? "vault" : envProvider ? "env" : "off";
  const llm: LlmSource = llmChoice && available[llmChoice] ? llmChoice : fallback;

  useEffect(() => {
    void init();
  }, [init]);

  const needsBase = mode === "range" || mode === "branch";
  const needsHead = mode === "range";
  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null;
  const repoMissing = selectedRepo?.available === false;
  const canRun = repoId !== null && !repoMissing && busy === null && (!needsBase || base.trim()) && (!needsHead || head.trim());

  async function run() {
    const id = await startAudit(
      {
        mode,
        ...(needsBase && base.trim() ? { base: base.trim() } : {}),
        ...((needsHead || mode === "commit") && head.trim() ? { head: head.trim() } : {}),
        ...(taskId.trim() ? { taskId: taskId.trim() } : {}),
        ...(planPath.trim() ? { planPath: planPath.trim() } : {}),
      },
      llm,
    );
    if (id && repoId) router.push(auditHref(repoId, id));
  }

  if (online === false) {
    return (
      <PageShell title="Auditorías" description="Revisa los cambios que hizo un agente de IA antes de aceptarlos.">
        <Panel>
          <PanelHeader icon={TerminalSquare} title="El auditor local no responde" description={`Se esperaba en ${AUDITOR_URL}.`} />
          <div className="space-y-3 px-5 py-4 text-sm text-fg-2">
            <p>El auditor corre en tu máquina (lee el repo y git); el navegador solo muestra los resultados. Arráncalo con:</p>
            <pre className="overflow-x-auto rounded-lg bg-app-2 p-3 font-mono text-xs text-fg">cd auditor{"\n"}npm install{"\n"}npm run serve</pre>
            <button type="button" className={BTN_SECONDARY} onClick={() => void init()}>
              <RefreshCw className="size-4" aria-hidden /> Reintentar
            </button>
          </div>
        </Panel>
      </PageShell>
    );
  }

  const shortRefs = [...(refs?.branches ?? []), ...(refs?.commits ?? []).map((commit) => commit.sha.slice(0, 10))];

  return (
    <PageShell
      title="Auditorías"
      description="Auditor independiente de cambios hechos por agentes de IA: reglas deterministas, reglas de tu repo y LLM BYOK validado. El resultado queda en Auditoria.md."
      wide
    >
      {error ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" className="text-xs underline" onClick={clearError}>
            Cerrar
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel>
          <PanelHeader icon={FolderGit2} title="Repositorio" description="Ruta local de un repo git. Se indexa fuera del repo (~/.archtrace)." />
          <div className="space-y-4 px-5 py-4">
            {repos.length > 0 ? (
              <label className="block text-xs font-medium text-fg-2">
                Repo vinculado
                <select className={cn(FIELD, "mt-1")} value={repoId ?? ""} onChange={(event) => void selectRepo(event.target.value)}>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.name} — {repo.root}
                      {repo.available === false ? " (no encontrado)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {repoMissing && selectedRepo ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
                La carpeta ya no existe (¿se movió o borró?).
                <button type="button" className="underline" onClick={() => void unlinkRepo(selectedRepo.id)}>
                  Quitar de la lista
                </button>
              </p>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (path.trim()) void linkRepo(path.trim()).then(() => setPath(""));
              }}
            >
              <input
                className={FIELD}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="C:\\ruta\\al\\repo  o  /home/yo/repo"
                aria-label="Ruta del repo a vincular"
              />
              <button type="submit" className={BTN_SECONDARY} disabled={!path.trim() || busy === "linking"}>
                {busy === "linking" ? "Indexando…" : "Vincular"}
              </button>
            </form>
            {refs ? (
              <p className="text-xs text-fg-3">
                Rama actual: <span className="font-mono text-fg-2">{refs.current ?? "(detached)"}</span>
                {refs.dirty ? " · hay cambios sin commitear" : ""}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={ShieldCheck} title="Nueva auditoría" description="Elige qué cambios revisar." />
          <form
            id={formId}
            className="space-y-4 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canRun) void run();
            }}
          >
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <legend className="sr-only">Modo</legend>
              {MODES.map((item) => (
                <label
                  key={item.id}
                  title={item.hint}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors",
                    mode === item.id ? "border-brand bg-brand/10 text-brand-strong" : "border-edge text-fg-2 hover:bg-app-2",
                  )}
                >
                  <input type="radio" name="mode" value={item.id} className="sr-only" checked={mode === item.id} onChange={() => setMode(item.id)} />
                  {item.label}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-fg-3">{MODES.find((item) => item.id === mode)?.hint}</p>

            <datalist id={`${formId}-refs`}>
              {shortRefs.map((ref) => (
                <option key={ref} value={ref} />
              ))}
            </datalist>
            <div className="grid gap-3 sm:grid-cols-2">
              {needsBase ? (
                <label className="block text-xs font-medium text-fg-2">
                  Base
                  <input className={cn(FIELD, "mt-1 font-mono")} list={`${formId}-refs`} value={base} onChange={(event) => setBase(event.target.value)} placeholder="main" />
                </label>
              ) : null}
              {needsHead || mode === "commit" ? (
                <label className="block text-xs font-medium text-fg-2">
                  {mode === "commit" ? "Commit (opcional)" : "Head"}
                  <input className={cn(FIELD, "mt-1 font-mono")} list={`${formId}-refs`} value={head} onChange={(event) => setHead(event.target.value)} placeholder="HEAD" />
                </label>
              ) : null}
              <label className="block text-xs font-medium text-fg-2">
                Tarea / requisito (opcional)
                <input className={cn(FIELD, "mt-1")} value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="JIRA-123" />
              </label>
              <label className="block text-xs font-medium text-fg-2">
                Plan del agente (opcional)
                <input className={cn(FIELD, "mt-1 font-mono")} value={planPath} onChange={(event) => setPlanPath(event.target.value)} placeholder="docs/plan.md" />
              </label>
            </div>

            <fieldset className="space-y-1.5 text-sm text-fg-2">
              <legend className="mb-1 text-xs font-medium">Análisis semántico con LLM</legend>
              <label className={cn("flex items-start gap-2", !available.vault && "opacity-60")}>
                <input type="radio" name="llm" className="mt-1" checked={llm === "vault"} disabled={!available.vault} onChange={() => setLlmChoice("vault")} />
                <span>
                  Clave del navegador{" "}
                  {aiProvider ? (
                    <span className="text-fg-3">
                      ({providerLabel(aiProvider)} · <span className="font-mono">{aiModel}</span>; viaja en la petición y el auditor no la guarda)
                    </span>
                  ) : (
                    <span className="text-fg-3">
                      — elige proveedor y pega la clave en{" "}
                      <Link href={DASHBOARD_ROUTES.api} className="underline">
                        API & Integración
                      </Link>
                    </span>
                  )}
                </span>
              </label>
              <label className={cn("flex items-start gap-2", !available.env && "opacity-60")}>
                <input type="radio" name="llm" className="mt-1" checked={llm === "env"} disabled={!available.env} onChange={() => setLlmChoice("env")} />
                <span>
                  Claves del auditor{" "}
                  <span className="text-fg-3">
                    {envProvider ? (
                      <>
                        ({envProvider.provider} · <span className="font-mono">{envProvider.model}</span>, de <span className="font-mono">auditor/.env</span>)
                      </>
                    ) : (
                      <>
                        — crea <span className="font-mono">auditor/.env</span> (ver <span className="font-mono">.env.example</span>) y reinicia el auditor. No lee{" "}
                        <span className="font-mono">web/.env</span>.
                      </>
                    )}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="llm" className="mt-1" checked={llm === "off"} onChange={() => setLlmChoice("off")} />
                <span>
                  Sin LLM <span className="text-fg-3">(solo reglas deterministas y reglas del repo)</span>
                </span>
              </label>
            </fieldset>

            <button type="submit" className={BTN_PRIMARY} disabled={!canRun}>
              <Play className="size-4" aria-hidden />
              {busy === "auditing" ? <Elapsed label="Auditando" /> : "Auditar cambios"}
            </button>
            {busy === "auditing" && llm !== "off" ? (
              <p className="text-xs text-fg-3">
                Con LLM puede tardar unos minutos. Si el proveedor está saturado o no responde, esas unidades se deciden por reglas y verás un aviso.
              </p>
            ) : null}
          </form>
        </Panel>
      </div>

      <Panel>
        <PanelHeader icon={History} title="Historial" description="Auditorías guardadas en .archtrace/audits del repo." />
        {audits.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-3">{repoId ? "Aún no hay auditorías en este repo." : "Vincula un repo para empezar."}</p>
        ) : (
          <ul className="divide-y divide-edge">
            {audits.map((audit) => (
              <li key={audit.id}>
                <Link href={auditHref(repoId!, audit.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-app-2">
                  <span className="font-mono text-xs text-fg-2">{audit.id}</span>
                  <span className="text-sm text-fg">
                    {audit.mode} · <span className="font-mono">{audit.base}</span> → <span className="font-mono">{audit.head}</span>
                  </span>
                  {audit.taskId ? <Badge tone="neutral">{audit.taskId}</Badge> : null}
                  <span className="flex flex-wrap gap-1.5">
                    {CRITICALITIES.filter((criticality) => audit.summary[criticality] > 0).map((criticality) => (
                      <Badge key={criticality} tone={CRITICALITY_TONE[criticality]}>
                        {CRITICALITY_LABEL[criticality]} {audit.summary[criticality]}
                      </Badge>
                    ))}
                  </span>
                  <span className="ml-auto text-xs text-fg-3">
                    revisados {audit.reviewed}/{audit.total} · {new Date(audit.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PageShell>
  );
}

/** Segundos transcurridos mientras el auditor trabaja (la petición es síncrona). */
function Elapsed({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span>
      {label}… {seconds} s
    </span>
  );
}
