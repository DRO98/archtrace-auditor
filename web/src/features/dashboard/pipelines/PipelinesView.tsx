"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, AudioLines, Bot, ChevronRight, FolderUp, History, Plus, Radio, Search, Server, Trash2, Workflow } from "lucide-react";
import type { CodeGraph } from "@core/graph";
import {
  ARCHITECTURE_KIND_INFO,
  detectArchitectureKind,
  type ArchitectureKind,
} from "@/features/canvas/lib/architectureKind";
import { PROJECT_GRAPH, pipelineHref } from "@/features/canvas/lib/graphName";
import { githubGraphName, hydrateMemoryGraphs, memoryGraph, memorySourceMeta, removeMemoryGraph } from "@/features/canvas/lib/memoryGraphs";
import { parseRepoRef } from "@/lib/github/client";
import { sharedDataFromHash } from "@/features/share/lib/shareState";
import { DEMOS, type DemoDefinition } from "@/features/demos";
import { AI_PROVIDER_IDS } from "@/lib/ai/catalog";
import { catalogPrice, costFor } from "@/lib/ai/costEstimate";
import { cn } from "@/lib/cn";
import { formatRatio, formatRunCost, formatRunLatency, type RunAggregate } from "@/features/runs/lib/runLog";
import { RunHistoryModal } from "@/features/runs/RunHistoryModal";
import { useRunAggregates } from "@/features/runs/store";
import { ImportSourceModal, type ImportTab } from "../knowledge/ImportSourceModal";
import { useKnowledgeSources, type KnowledgeSource } from "../knowledge/useSources";
import { PageShell } from "../PageShell";
import { BTN_PRIMARY, BTN_SECONDARY, Badge, FIELD, GithubMark, type BadgeTone, type IconComponent } from "../ui";

type Stage = "production" | "demo";

interface PipelineCard {
  graphName: string;
  title: string;
  description: string;
  icon: IconComponent;
  stage: Stage;
  tags: { label: string; tone: BadgeTone }[];
  nodes: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  /** Por qué falta una métrica (tooltip). */
  pendingHint: string;
  /** Ejecuciones reales registradas en el historial; sus medias sustituyen a las estimaciones. */
  runs: RunAggregate | null;
  /** Tipo de arquitectura detectado en el grafo; null mientras el grafo carga. */
  kind: ArchitectureKind | null;
  /** Importado en este navegador: se puede borrar del catálogo. */
  removable: boolean;
}

function kindOf(graph: CodeGraph | null): ArchitectureKind | null {
  return graph ? detectArchitectureKind(graph) : null;
}

/** Etiquetas y icono de cada demo del catálogo. */
const DEMO_TRAITS: Record<string, { icon: IconComponent; tags: PipelineCard["tags"] }> = {
  demo_rag_documents: { icon: Workflow, tags: [{ label: "RAG Local", tone: "live" }] },
  demo_tool_agent: { icon: Bot, tags: [{ label: "Agente", tone: "sky" }] },
  demo_audio_pipeline: { icon: AudioLines, tags: [{ label: "Audio", tone: "amber" }] },
  demo_event_shop: { icon: Radio, tags: [{ label: "Event-driven", tone: "sky" }] },
  demo_api_backend: { icon: Server, tags: [{ label: "REST", tone: "sky" }] },
};

/**
 * Coste de una ejecución de la demo con la tarifa del catálogo. Las demos simulan modelos de Ollama
 * (`llama3:8b`): una etiqueta `modelo:tamaño` sin tarifa cuenta como local, coste 0.
 */
function demoCost(demo: DemoDefinition): number | null {
  // Sin perfil RAG no hay modelo de IA: la demo no gasta tokens.
  if (!demo.playground) return 0;
  const model = demo.playground.model.replace(/\s*\(simulado\)\s*$/, "").split(/\s+/)[0] ?? "";
  for (const provider of AI_PROVIDER_IDS) {
    const price = catalogPrice(provider, model);
    if (price) return costFor(price, demo.playground.usage);
  }
  return model.includes(":") ? 0 : null;
}

/** Latencia de referencia: la de la consulta grabada (RAG) o la del escenario principal (resto). */
function demoLatency(demo: DemoDefinition): number {
  if (demo.playground) return demo.playground.stages.reduce((total, stage) => total + stage.latencyMs, 0);
  const steps = demo.scenarios.scenarios[0]?.steps ?? [];
  return steps.reduce((total, step) => total + (step.metrics?.latencyMs ?? 0), 0);
}

function demoCard(demo: DemoDefinition): PipelineCard {
  const traits = DEMO_TRAITS[demo.graphName] ?? { icon: Workflow, tags: [] };
  return {
    graphName: demo.graphName,
    title: demo.title,
    description: demo.tagline,
    icon: traits.icon,
    stage: "demo",
    tags: traits.tags,
    nodes: demo.graph.modules.length,
    latencyMs: demoLatency(demo),
    costUsd: demoCost(demo),
    pendingHint: "",
    runs: null,
    kind: kindOf(demo.graph),
    removable: false,
  };
}

function sourceCard(source: KnowledgeSource): PipelineCard {
  const pendingHint = "Se mide al ejecutarlo en «Probar en vivo»";
  const nodes = source.graph?.modules.length ?? null;
  if (source.kind === "repo") {
    return {
      graphName: source.name,
      title: "Repositorio del proyecto",
      description: "Arquitectura de tu repositorio conectado al IDE: módulos, dependencias y flujo de datos, sincronizados con tu editor. Su tipo se detecta al cargarlo.",
      icon: Workflow,
      stage: "production",
      tags: [{ label: "IDE", tone: "brand" }],
      nodes,
      latencyMs: null,
      costUsd: null,
      pendingHint,
      runs: null,
      kind: kindOf(source.graph),
      removable: false,
    };
  }
  const github = source.kind === "github";
  const tags: PipelineCard["tags"] = [{ label: github ? "GitHub" : "Local", tone: "neutral" }];
  if (source.meta?.isPrivate) tags.push({ label: "Privado", tone: "amber" });
  return {
    graphName: source.name,
    title: source.label,
    description: github
      ? `Importado de GitHub${source.meta?.ref ? ` (${source.meta.ref})` : ""}. Guardado solo en este navegador.`
      : "Carpeta local analizada en tu navegador. Guardada solo en este navegador.",
    icon: github ? GithubMark : FolderUp,
    stage: "production",
    tags,
    nodes,
    latencyMs: null,
    costUsd: null,
    pendingHint,
    runs: null,
    kind: kindOf(source.graph),
    removable: true,
  };
}

/** Con ejecuciones registradas, la latencia y el coste de la tarjeta pasan a ser la media real. */
function withRuns(card: PipelineCard, runs: RunAggregate | undefined): PipelineCard {
  if (!runs || runs.count === 0) return card;
  return { ...card, runs, latencyMs: runs.avgLatencyMs, costUsd: runs.avgCostUsd ?? card.costUsd };
}

/** Abrir un repo de GitHub: el grafo guardado en este navegador si ya existe (misma rama), o `null` para importarlo. */
async function existingGraphFor(input: string): Promise<string | null> {
  const repo = parseRepoRef(input);
  if (!repo) return null;
  await hydrateMemoryGraphs();
  const name = githubGraphName(repo.owner, repo.repo);
  if (!memoryGraph(name)) return null;
  return !repo.ref || memorySourceMeta(name)?.ref === repo.ref ? name : null;
}

export function PipelinesView({ initialRepo }: { initialRepo?: string }) {
  const router = useRouter();
  const sources = useKnowledgeSources();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState<{ tab: ImportTab; repo?: string } | null>(null);
  /** Historial abierto: `null` = cerrado, `""` = todos los pipelines. */
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const aggregates = useRunAggregates();

  // Enlaces compartidos antiguos (`/#data=…`): el hash llega aquí tras la redirección de `/`; se abren en el editor.
  useEffect(() => {
    if (sharedDataFromHash(window.location.hash)) router.replace(`${pipelineHref(PROJECT_GRAPH)}${window.location.hash}`);
  }, [router]);

  function openRepo(input: string): void {
    void existingGraphFor(input).then((name) => {
      if (name) router.push(pipelineHref(name));
      else setImporting({ tab: "github", repo: input });
    });
  }

  // Deep link `?repo=owner/name`: se consume una vez y se limpia de la URL (recargar no relanza la importación).
  useEffect(() => {
    if (!initialRepo) return;
    router.replace(window.location.pathname);
    openRepo(initialRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  const cards = useMemo(
    () => [...sources.map(sourceCard), ...DEMOS.map(demoCard)].map((card) => withRuns(card, aggregates.get(card.graphName))),
    [sources, aggregates],
  );
  const needle = query.trim().toLowerCase();
  const visible = cards.filter(
    (card) => !needle || card.title.toLowerCase().includes(needle) || card.graphName.includes(needle) || card.description.toLowerCase().includes(needle),
  );
  const own = visible.filter((card) => card.stage === "production");
  const examples = visible.filter((card) => card.stage === "demo");

  return (
    <PageShell
      title="Pipelines"
      description="Visualiza, simula y prueba la arquitectura de cualquier sistema sobre el lienzo: APIs, microservicios con eventos o pipelines de IA."
      actions={
        <>
          <button type="button" onClick={() => setHistoryFor("")} className={BTN_SECONDARY}>
            <History className="size-4" aria-hidden />
            Historial de ejecuciones
          </button>
          {/* Secundario: el CTA principal es «Understand any repository»; esto abre el mismo import con más opciones. */}
          <button type="button" onClick={() => setImporting({ tab: "github" })} className={BTN_SECONDARY}>
            <Plus className="size-4" aria-hidden />
            Nuevo Pipeline
          </button>
        </>
      }
    >
      <RepoUrlHero onOpen={openRepo} onLocal={() => setImporting({ tab: "local" })} />

      <div className="flex flex-col gap-4">
        <PipelineSection
          title="Tus pipelines"
          cards={own}
          query={query}
          onHistory={setHistoryFor}
          onRemove={(name) => removeMemoryGraph(name)}
          empty="Todavía no has importado ningún repositorio."
          actions={
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Buscar pipelines</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre o ID…"
                className="h-9 w-full rounded-lg border border-edge bg-panel pr-3 pl-9 text-sm text-fg placeholder:text-fg-3 focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none"
              />
            </label>
          }
        />
        {/* Las demos no gastan cuota pero no son el héroe: plegadas debajo de los imports (se despliegan al buscar). */}
        <PipelineSection
          title="Examples"
          description="Demos con datos simulados: explora, simula y prueba sin configurar nada."
          cards={examples}
          query={query}
          onHistory={setHistoryFor}
          empty="No hay ejemplos."
          collapsible
        />
      </div>

      {historyFor !== null ? <RunHistoryModal graphName={historyFor || null} onClose={() => setHistoryFor(null)} /> : null}

      {importing ? (
        <ImportSourceModal
          initialTab={importing.tab}
          initialRepo={importing.repo}
          onClose={() => setImporting(null)}
          onImported={(name) => {
            setImporting(null);
            router.push(pipelineHref(name));
          }}
        />
      ) : null}
    </PageShell>
  );
}

/** Entrada principal: pegar la URL de un repo de GitHub y ver su arquitectura, sin extensión ni cuenta. */
function RepoUrlHero({ onOpen, onLocal }: { onOpen: (repo: string) => void; onLocal: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!parseRepoRef(value)) {
      setError("Invalid format. Use owner/repo, owner/repo@branch or a GitHub URL.");
      return;
    }
    setError(null);
    onOpen(value.trim());
  }

  return (
    <section aria-labelledby="repo-hero-title" className="rounded-xl border border-brand/30 bg-brand/5 px-4 py-3.5">
      <h2 id="repo-hero-title" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
        <GithubMark className="size-4" />
        Understand any repository
      </h2>
      <p className="mt-0.5 text-sm text-fg-2">
        Paste a GitHub repo URL and get its architecture map. It&apos;s analyzed in your browser: your code never goes through our servers.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">GitHub repository</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            autoComplete="off"
            className={cn(FIELD, "w-full font-mono text-sm")}
          />
        </label>
        <button type="submit" disabled={value.trim() === ""} className={BTN_PRIMARY}>
          Map it
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onLocal}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-fg-3 underline-offset-2 hover:text-fg hover:underline"
      >
        <FolderUp className="size-3.5" aria-hidden />or analyze a folder on your disk
      </button>
    </section>
  );
}

function PipelineSection({
  title,
  description,
  cards,
  query,
  empty,
  onHistory,
  onRemove,
  actions,
  collapsible = false,
}: {
  title: string;
  description?: string;
  cards: readonly PipelineCard[];
  query: string;
  empty: string;
  onHistory: (graphName: string) => void;
  onRemove?: (graphName: string) => void;
  /** Controles a la derecha del título (p. ej. buscador), misma fila. */
  actions?: ReactNode;
  /** Plegada por defecto; buscar la despliega para que los resultados no queden ocultos. */
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const searching = query.trim() !== "";
  const open = !collapsible || expanded || (searching && cards.length > 0);
  const count = <span className="font-mono text-[11px] font-normal text-fg-3">{cards.length}</span>;
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">
            {collapsible ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 rounded-md hover:text-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
              >
                <ChevronRight className={cn("size-4 text-fg-3 transition-transform", open && "rotate-90")} aria-hidden />
                {title} {count}
              </button>
            ) : (
              <>
                {title} {count}
              </>
            )}
          </h2>
          {description ? <p className="text-xs text-fg-3">{description}</p> : null}
        </div>
        {actions}
      </div>
      {!open ? null : cards.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <li key={card.graphName}>
              <PipelineTile
                card={card}
                onHistory={() => onHistory(card.graphName)}
                onRemove={card.removable && onRemove ? () => onRemove(card.graphName) : undefined}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-edge px-6 py-6 text-center text-sm text-fg-3">
          {query.trim() ? `Nada coincide con «${query}».` : empty}
        </p>
      )}
    </section>
  );
}

/**
 * Tarjeta de pipeline. El título es un enlace estirado (`after:inset-0`) que cubre la tarjeta entera, así el
 * botón de historial puede vivir dentro sin anidar elementos interactivos en el `<a>`.
 */
function PipelineTile({ card, onHistory, onRemove }: { card: PipelineCard; onHistory: () => void; onRemove?: () => void }) {
  const Icon = card.icon;
  const production = card.stage === "production";
  const runs = card.runs;
  const measured = runs !== null;
  return (
    <article className="group relative flex h-full flex-col rounded-xl border border-edge bg-panel transition-all focus-within:border-brand/50 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-[0_12px_40px_-16px] hover:shadow-brand/40 motion-reduce:hover:translate-y-0">
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg border",
              production ? "border-brand/30 bg-brand/10 text-brand-soft" : "border-edge bg-app-2 text-fg-2",
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
          <ArrowUpRight className="size-4 text-fg-3 transition-colors group-hover:text-brand-soft" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-fg" title={card.title}>
            <Link
              href={pipelineHref(card.graphName)}
              className="rounded-xl outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-brand"
            >
              {card.title}
            </Link>
          </h2>
          <p className="mt-0.5 line-clamp-2 text-sm text-fg-2">{card.description}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5">
          <Badge tone={production ? "live" : "brand"} dot={production}>
            {production ? "Producción" : "Demo"}
          </Badge>
          {card.kind ? <Badge tone="neutral">{ARCHITECTURE_KIND_INFO[card.kind].short}</Badge> : null}
          {card.tags.map((tag) => (
            <Badge key={tag.label} tone={tag.tone}>
              {tag.label}
            </Badge>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-edge border-t border-edge">
        <TileMetric label="Nodos" value={card.nodes === null ? "—" : String(card.nodes)} hint={card.nodes === null ? "Cargando grafo…" : undefined} />
        <TileMetric
          label="Latencia"
          value={formatRunLatency(card.latencyMs)}
          hint={measured ? `Media de ${runs.count} ejecuciones · p95 ${formatRunLatency(runs.p95LatencyMs)}` : card.latencyMs === null ? card.pendingHint : "Latencia de la ejecución de ejemplo"}
        />
        <TileMetric
          label="Coste / run"
          value={formatRunCost(card.costUsd)}
          hint={measured ? `Media real · total ${formatRunCost(runs.totalCostUsd)}` : card.costUsd === null ? card.pendingHint : "Estimado con la tarifa del modelo"}
        />
      </dl>
      <div className="flex items-center gap-2 border-t border-edge px-4 py-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">{card.graphName}</p>
        {onRemove ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`¿Eliminar «${card.title}» de este navegador?`)) onRemove();
            }}
            title="Eliminar de este navegador"
            className="relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Trash2 className="size-3.5" aria-hidden />
            <span className="sr-only">Eliminar</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onHistory}
          title="Historial de ejecuciones"
          className="relative z-10 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-fg-3 hover:bg-panel-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
        >
          <History className="size-3.5" aria-hidden />
          {measured ? `${runs.count} runs${runs.avgRelevance !== null ? ` · ${formatRatio(runs.avgRelevance)} relev.` : ""}` : "Historial"}
        </button>
      </div>
    </article>
  );
}

function TileMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-3 py-2.5" title={hint}>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-fg-3">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-fg">{value}</dd>
    </div>
  );
}
