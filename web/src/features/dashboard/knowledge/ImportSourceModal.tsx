"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Container, FolderUp, KeyRound, Loader2, ShieldCheck, UploadCloud } from "lucide-react";
import { Paywall } from "@/features/billing/Paywall";
import { canImport } from "@/features/billing/quota";
import { useBilling } from "@/features/billing/store";
import { githubGraphName, localGraphName, registerMemoryGraph } from "@/features/canvas/lib/memoryGraphs";
import { cn } from "@/lib/cn";
import { GithubError, parseRepoRef, readSessionToken, saveSessionToken } from "@/lib/github/client";
import { MAX_FILES, importGithubRepo, type ImportProgress } from "@/lib/github/importRepo";
import { entriesFromDataTransfer, entriesFromFileList, importLocalEntries, type LocalEntry } from "@/lib/local/importLocal";
import { markImportFinished, markImportStarted } from "@/lib/metrics/localMetrics";
import { BTN_PRIMARY, BTN_SECONDARY, Badge, FIELD, GithubMark, Modal, Tabs, type TabItem } from "../ui";

export type ImportTab = "github" | "local" | "docker";

/*
 * Indexar desde un contenedor Docker: NO operativo todavía. No existe ejecutor remoto ni lectura de
 * volúmenes (ni en `web/` ni en la extensión), así que `DockerTab` solo muestra un formulario deshabilitado.
 * Se mantiene el código tipado y compilando, pero oculto de la UI comercial hasta que haya backend:
 * para activarlo, implementar el conector y poner este flag a `true`.
 */
export const DOCKER_INDEXING_ENABLED = false;

/** Cuota Free: `true` si se puede importar `name` (Pro, reimportación o hueco libre). Espera a leer la cuota. */
async function quotaAllows(name: string): Promise<boolean> {
  await useBilling.getState().hydrate();
  const { imported, license } = useBilling.getState();
  return canImport(name, imported, license !== null);
}

const ALL_TABS: readonly TabItem<ImportTab>[] = [
  { id: "github", label: "GitHub", icon: GithubMark },
  { id: "local", label: "Local folder", icon: FolderUp },
  { id: "docker", label: "Docker", icon: Container },
];

const TABS = ALL_TABS.filter((tab) => DOCKER_INDEXING_ENABLED || tab.id !== "docker");

export function isImportTab(value: string | null): value is ImportTab {
  return value === "github" || value === "local" || (DOCKER_INDEXING_ENABLED && value === "docker");
}

/**
 * Añadir una fuente de conocimiento. Todo se procesa en el navegador; `onImported` recibe el nombre del grafo.
 * Con `initialRepo` (URL pegada en Pipelines o deep link `/?repo=`), la pestaña GitHub arranca la importación sola.
 */
export function ImportSourceModal({
  initialTab = "github",
  initialRepo,
  onClose,
  onImported,
}: {
  initialTab?: ImportTab;
  initialRepo?: string;
  onClose: () => void;
  onImported: (name: string) => void;
}) {
  const [tab, setTab] = useState<ImportTab>(initialTab === "docker" && !DOCKER_INDEXING_ENABLED ? "github" : initialTab);
  const [busy, setBusy] = useState(false);
  /** Paywall abierto: `repo` es el import de GitHub que se reintenta solo si se activa una licencia. */
  const [paywall, setPaywall] = useState<{ repo?: string } | null>(null);
  const [retry, setRetry] = useState<{ repo?: string; attempt: number }>({ repo: initialRepo, attempt: 0 });

  if (paywall) {
    return (
      <Modal title="Upgrade to Pro" onClose={onClose} className="max-w-lg">
        <div className="p-5">
          <Paywall
            onCancel={onClose}
            onActivated={() => {
              setRetry((current) => ({ repo: paywall.repo, attempt: current.attempt + 1 }));
              setPaywall(null);
            }}
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Map a repository"
      description="Import code to build its architecture map. It's analyzed in your browser: nothing goes through our servers."
      onClose={busy ? () => {} : onClose}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-5 p-5">
        <Tabs items={TABS} value={tab} onChange={(next) => !busy && setTab(next)} label="Source type" />
        {tab === "github" ? (
          <GithubTab
            key={retry.attempt}
            initialRepo={retry.repo}
            onBusy={setBusy}
            onImported={onImported}
            onQuotaExceeded={(repo) => setPaywall({ repo })}
          />
        ) : null}
        {tab === "local" ? <LocalTab onBusy={setBusy} onImported={onImported} onQuotaExceeded={() => setPaywall({})} /> : null}
        {DOCKER_INDEXING_ENABLED && tab === "docker" ? <DockerTab /> : null}
      </div>
    </Modal>
  );
}

function ZeroDataNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-live/20 bg-live/5 px-3 py-2.5 text-xs text-fg-2">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-live" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
      {message}
    </p>
  );
}

function progressLabel(progress: ImportProgress): string {
  if (progress.phase === "tree") return "Reading the repository tree…";
  if (progress.phase === "graph") return "Building the graph in memory…";
  return `Downloading sources ${progress.done}/${progress.total}…`;
}

/**
 * El token solo se pide cuando hace falta: un repo público se importa sin él, y si GitHub responde 401/403/404/429
 * (repo privado o límite de peticiones agotado) aparece el campo con el motivo.
 */
function needsToken(reason: unknown): boolean {
  return reason instanceof GithubError && [401, 403, 404, 429].includes(reason.status);
}

/** Repo público o privado con un Personal Access Token: el navegador habla directo con `api.github.com`. */
function GithubTab({
  initialRepo,
  onBusy,
  onImported,
  onQuotaExceeded,
}: {
  initialRepo?: string;
  onBusy: (busy: boolean) => void;
  onImported: (name: string) => void;
  onQuotaExceeded: (repo: string) => void;
}) {
  const [repoInput, setRepoInput] = useState(initialRepo ?? "");
  const [token, setToken] = useState(readSessionToken);
  const [remember, setRemember] = useState(() => readSessionToken() !== "");
  const [showToken, setShowToken] = useState(() => readSessionToken() !== "");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const busy = progress !== null;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await start(repoInput);
  }

  async function start(input: string): Promise<void> {
    const repo = parseRepoRef(input);
    if (!repo) {
      setError("Invalid format. Use owner/repo, owner/repo@branch or a GitHub URL.");
      return;
    }
    const name = githubGraphName(repo.owner, repo.repo);
    if (!(await quotaAllows(name))) {
      onQuotaExceeded(input);
      return;
    }
    const pat = token.trim();
    saveSessionToken(remember ? pat : "");
    setError(null);
    onBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    markImportStarted();
    try {
      const { graph, stats } = await importGithubRepo(repo, pat, { signal: controller.signal, onProgress: setProgress });
      registerMemoryGraph(name, graph, {
        kind: "github",
        label: `${repo.owner}/${repo.repo}`,
        ref: stats.ref,
        isPrivate: stats.isPrivate,
        sensitive: stats.sensitive,
        skipped: stats.skipped + stats.tooLarge,
        analyzed: stats.analyzed,
        tooLarge: stats.tooLarge,
        truncatedTree: stats.truncatedTree,
        context: stats.context,
        parts: stats.parts,
      });
      useBilling.getState().recordImport(name);
      markImportFinished(name);
      onImported(name);
    } catch (reason) {
      if (controller.signal.aborted) return;
      markImportFinished(null);
      const message = reason instanceof Error ? reason.message : "Could not import the repository.";
      if (needsToken(reason) && !pat) {
        setShowToken(true);
        setError(`${message} If the repo is private or the anonymous rate limit ran out, add a Personal Access Token and try again.`);
      } else {
        setError(message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
      onBusy(false);
    }
  }

  useEffect(() => {
    // URL pegada en Pipelines o deep link: se importa sin otro clic.
    if (!initialRepo || autoStarted.current) return;
    autoStarted.current = true;
    void start(initialRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
        Repository
        <input
          required
          value={repoInput}
          onChange={(event) => setRepoInput(event.target.value)}
          placeholder="owner/repo · owner/repo@branch · https://github.com/owner/repo"
          disabled={busy}
          className={cn(FIELD, "font-mono text-xs")}
        />
      </label>
      {showToken ? (
        <>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
            <span className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" aria-hidden />
              Personal Access Token <span className="font-normal text-fg-3">· required for private repos</span>
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="github_pat_…"
              disabled={busy}
              className={cn(FIELD, "font-mono text-xs")}
            />
            <span className="font-normal text-fg-3">
              Read-only fine-grained token with the <span className="font-mono text-fg-2">Contents: read</span> permission.
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-2">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} className="accent-brand" />
            Remember the token in this tab only (sessionStorage)
          </label>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowToken(true)}
          disabled={busy}
          className="flex items-center gap-1.5 self-start text-xs text-fg-3 underline-offset-2 hover:text-fg hover:underline"
        >
          <KeyRound className="size-3.5" aria-hidden />
          Private repo? Add a Personal Access Token
        </button>
      )}
      <ZeroDataNote>
        <strong className="text-fg">Zero-Data Retention.</strong> Neither your token nor your code goes through our servers. Before downloading we
        skip <span className="font-mono">.git</span>, <span className="font-mono">node_modules</span>, <span className="font-mono">.env*</span>,
        <span className="font-mono">.pem/.key</span> keys and secret files.
      </ZeroDataNote>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex items-center justify-end gap-2">
        {progress ? (
          <span role="status" className="mr-auto flex items-center gap-1.5 text-xs text-fg-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {progressLabel(progress)}
          </span>
        ) : null}
        <button type="submit" disabled={busy || repoInput.trim() === ""} className={BTN_PRIMARY}>
          {busy ? "Importing…" : "Import repository"}
        </button>
      </div>
    </form>
  );
}

/** Carpeta del disco por arrastrar y soltar o selector: se lee con la File API, sin subir nada. */
function LocalTab({
  onBusy,
  onImported,
  onQuotaExceeded,
}: {
  onBusy: (busy: boolean) => void;
  onImported: (name: string) => void;
  onQuotaExceeded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const busy = status !== null;

  useEffect(() => {
    // `webkitdirectory` no está en los tipos de React: se activa sobre el nodo.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function run(collect: () => Promise<{ entries: LocalEntry[]; sensitive: number }>): Promise<void> {
    // La cuota se comprueba tras leer la carpeta (solo entonces se sabe si es una reimportación): esperar antes de
    // `collect` invalidaría los `DataTransferItem` del drop, que solo viven durante el evento.
    setError(null);
    setStatus("Reading files…");
    onBusy(true);
    markImportStarted();
    try {
      const { entries, sensitive } = await collect();
      setStatus(`Analyzing ${Math.min(entries.length, MAX_FILES)} files…`);
      const { graph, projectName, stats } = await importLocalEntries(entries, sensitive);
      const name = localGraphName(projectName);
      if (!(await quotaAllows(name))) {
        markImportFinished(null);
        onQuotaExceeded();
        return;
      }
      registerMemoryGraph(name, graph, {
        kind: "local",
        label: projectName,
        sensitive: stats.sensitive,
        skipped: stats.skipped + stats.tooLarge,
        analyzed: stats.analyzed,
        tooLarge: stats.tooLarge,
        context: stats.context,
        parts: stats.parts,
      });
      useBilling.getState().recordImport(name);
      markImportFinished(name);
      onImported(name);
    } catch (reason) {
      markImportFinished(null);
      setError(reason instanceof Error ? reason.message : "Could not read the folder.");
    } finally {
      setStatus(null);
      onBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const items = event.dataTransfer.items;
    void run(() => entriesFromDataTransfer(items));
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-brand bg-brand/10" : "border-edge-strong bg-app-2 hover:border-brand/60",
          busy && "pointer-events-none opacity-70",
        )}
      >
        <span className="grid size-11 place-items-center rounded-xl border border-edge bg-panel text-brand-soft" aria-hidden>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
        </span>
        <span className="text-sm font-medium text-fg">{status ?? "Drop your project folder here"}</span>
        <span className="text-xs text-fg-3">
          or <span className="text-brand-soft underline underline-offset-2">pick it from your disk</span> · Python, JS, TS, Go, Java… · up to {MAX_FILES} files
        </span>
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void run(async () => ({ entries: entriesFromFileList(files), sensitive: 0 }));
            event.target.value = "";
          }}
        />
      </label>
      <ZeroDataNote>
        Files are read with the browser&apos;s File API and only the graph (paths, classes, functions and imports) is kept, in this browser
        (IndexedDB). Folders like <span className="font-mono">node_modules</span> or <span className="font-mono">.git</span> and secrets are never opened.
      </ZeroDataNote>
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}

/** Conexión con un contenedor (oculta tras `DOCKER_INDEXING_ENABLED`): aún sin ejecutor remoto. */
function DockerTab() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-app-2 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">Indexar desde un contenedor</p>
          <p className="mt-1 text-xs text-fg-3">
            Conecta un volumen de un contenedor en ejecución para indexar su código sin copiarlo a tu máquina.
          </p>
        </div>
        <Badge tone="amber">Próximamente</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-3">
          Contenedor
          <input disabled placeholder="archtrace-web" className={cn(FIELD, "font-mono text-xs")} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-3">
          Ruta del volumen
          <input disabled placeholder="/app" className={cn(FIELD, "font-mono text-xs")} />
        </label>
      </div>
      <div className="rounded-lg border border-edge bg-app p-3">
        <p className="mb-2 text-xs text-fg-3">Mientras tanto, puedes autoalojar ArchTrace con Docker Compose:</p>
        <pre className="scrollbar-thin overflow-x-auto font-mono text-xs text-fg-2">
          <span className="text-fg-3">$ </span>cd web && docker compose up -d --build
        </pre>
      </div>
      <div className="flex justify-end">
        <button type="button" disabled className={BTN_SECONDARY}>
          Conectar contenedor
        </button>
      </div>
    </div>
  );
}
