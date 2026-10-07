"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";
import type { CodeModule } from "@core/graph";
import { cn } from "@/lib/cn";
import { inferRole } from "@/features/canvas/lib/architecture";
import { calculateBlastRadius, summarizeImpact, type BlastEdge } from "@/features/canvas/lib/blastRadius";
import { moduleRange } from "@/features/canvas/lib/graph";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { useCanvasStore } from "@/features/canvas/store";
import { ModuleIcon } from "@/features/canvas/nodes/ModuleIcon";
import { ROLE_TONE } from "@/features/canvas/theme";
import { ComponentMetricsKpis, KpiCell } from "@/features/simulation/components/MetricsCards";
import { componentMetrics } from "@/features/simulation/lib/metrics";
import { useSimStore } from "@/features/simulation/store";
import { ChangeBriefCard } from "./ChangeBriefCard";
import { RagCostEstimatorCard } from "./RagCostEstimatorCard";
import {
  CALLER_RISK,
  FILTER_THRESHOLD,
  directCallers,
  edgeFor,
  matchesQuery,
  overallRisk,
  riskForDepth,
  type RiskBadge,
  type RiskLevel,
} from "./lib/impact";

type Direction = "outgoing" | "incoming";

interface ImpactItem {
  module: CodeModule;
  depth: number;
  risk: RiskBadge;
  edgeId: string | null;
}

/** Semáforo: verde (sin riesgo / acotado), amarillo (dependencia moderada), rojo (crítico / rompe contrato). */
const RISK_TONE: Record<RiskLevel, string> = {
  high: "border-rose-300 bg-rose-50 text-rose-800",
  contract: "border-rose-300 bg-rose-50 text-rose-800",
  secondary: "border-amber-300 bg-amber-50 text-amber-900",
  indirect: "border-emerald-300 bg-emerald-50 text-emerald-800",
  none: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

/** Punto del semáforo en la celda KPI de riesgo. */
const RISK_DOT: Record<RiskLevel, string> = {
  high: "bg-rose-500",
  contract: "bg-rose-500",
  secondary: "bg-amber-400",
  indirect: "bg-emerald-500",
  none: "bg-emerald-500",
};

/** Etiqueta corta del riesgo global para la cabecera. */
const RISK_SHORT: Record<RiskLevel, string> = {
  high: "Crítico",
  contract: "Crítico",
  secondary: "Moderado",
  indirect: "Acotado",
  none: "Sin riesgo",
};

const CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";

function openModule(codeModule: CodeModule): void {
  const range = moduleRange(codeModule);
  syncEditorTo(
    { filePath: codeModule.filePath, line: range?.startLine ?? 1, endLine: range?.endLine },
    { allowDeepLink: true },
  );
}

function highlight(edgeId: string | null): void {
  useCanvasStore.getState().setImpactHoverEdge(edgeId);
}

function ImpactChip({ item, direction }: { item: ImpactItem; direction: Direction }) {
  const { module: codeModule, depth, risk, edgeId } = item;
  const role = codeModule.role ?? inferRole(codeModule);
  const level = direction === "outgoing" && depth > 1 ? ` · nivel ${depth}` : "";
  return (
    <li className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => openModule(codeModule)}
        onMouseEnter={() => highlight(edgeId)}
        onMouseLeave={() => highlight(null)}
        onFocus={() => highlight(edgeId)}
        onBlur={() => highlight(null)}
        title={`${codeModule.filePath}${level} · ${risk.label}. Clic para abrir en el editor.`}
        className={cn(
          "inline-flex max-w-full items-center overflow-hidden rounded-md border text-[11px] leading-5 transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-accent",
          RISK_TONE[risk.level],
        )}
      >
        <span className="flex min-w-0 items-center gap-1 bg-white px-1.5 font-medium text-slate-800">
          <span className={cn("grid size-4 shrink-0 place-items-center rounded", ROLE_TONE[role].tile)} aria-hidden>
            <ModuleIcon role={role} filePath={codeModule.filePath} className="size-2.5" />
          </span>
          <span className="truncate">{codeModule.label}</span>
        </span>
        <span className="shrink-0 border-l border-current/20 px-1.5 font-semibold">
          {risk.label}
          {level ? <span className="font-normal opacity-70">{` · n${depth}`}</span> : null}
        </span>
      </button>
    </li>
  );
}

function ImpactGroup({
  title,
  icon: Icon,
  direction,
  items,
  empty,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  direction: Direction;
  items: readonly ImpactItem[];
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) => matchesQuery(query, item.module.label, item.module.filePath));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h4 className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Icon className="size-3" aria-hidden />
          {title} <span className="font-normal tabular-nums">({items.length})</span>
        </h4>
        {items.length > FILTER_THRESHOLD ? (
          <label className="relative ml-auto block w-36">
            <span className="sr-only">Buscar dependencia en {title}</span>
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar…"
              className="h-6 w-full rounded-md border border-slate-200 bg-white pl-6 pr-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </label>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400">{empty}</p>
      ) : filtered.length === 0 ? (
        <p className="text-[11px] text-slate-500">Ninguna coincide con «{query}».</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {filtered.map((item) => (
            <ImpactChip key={item.module.id} item={item} direction={direction} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImpactTab({ edges }: { edges: readonly BlastEdge[] }) {
  const sourceId = useCanvasStore((state) => state.selectedImpactNodeId);
  const active = useCanvasStore((state) => state.impactAnalysisMode);
  const modulesById = useCanvasStore((state) => state.indexes?.modulesById ?? null);
  const scenarios = useSimStore((state) => state.scenarios);
  const activeScenarioId = useSimStore((state) => state.activeScenarioId);

  const blast = useMemo(
    () => (active && sourceId ? calculateBlastRadius(sourceId, edges) : null),
    [active, sourceId, edges],
  );
  const summary = useMemo(
    () => (blast && modulesById ? summarizeImpact(blast.depthMap, modulesById) : null),
    [blast, modulesById],
  );
  const outgoing = useMemo<ImpactItem[]>(() => {
    if (!blast || !modulesById || !sourceId) return [];
    return Object.entries(blast.depthMap)
      .flatMap(([id, depth]) => {
        const codeModule = modulesById.get(id);
        return codeModule
          ? [{ module: codeModule, depth, risk: riskForDepth(depth), edgeId: edgeFor("outgoing", sourceId, id, edges, blast.affectedEdgeIds) }]
          : [];
      })
      .sort((a, b) => a.depth - b.depth || a.module.label.localeCompare(b.module.label));
  }, [blast, modulesById, sourceId, edges]);
  const incoming = useMemo<ImpactItem[]>(() => {
    if (!modulesById || !sourceId || !active) return [];
    return directCallers(sourceId, edges)
      .flatMap((id) => {
        const codeModule = modulesById.get(id);
        return codeModule ? [{ module: codeModule, depth: 1, risk: CALLER_RISK, edgeId: edgeFor("incoming", sourceId, id, edges) }] : [];
      })
      .sort((a, b) => a.module.label.localeCompare(b.module.label));
  }, [active, modulesById, sourceId, edges]);

  // Escenario del que sacar coste y rendimiento: el activo si pasa por el componente; si no, el primero que lo mida.
  const metricsScenario = useMemo(() => {
    if (!sourceId) return null;
    const active = scenarios.find((item) => item.id === activeScenarioId);
    const ordered = active ? [active, ...scenarios.filter((item) => item !== active)] : scenarios;
    return ordered.find((item) => componentMetrics(item, sourceId) !== null) ?? null;
  }, [scenarios, activeScenarioId, sourceId]);

  // El resaltado es transitorio: no debe sobrevivir al cambiar de pestaña o de módulo.
  useEffect(() => () => useCanvasStore.getState().setImpactHoverEdge(null), [sourceId]);

  if (!active || !sourceId) {
    return (
      <div className="flex min-h-full flex-col gap-3 bg-slate-50/60 px-4 py-3">
        <p className="px-2 py-6 text-center text-sm text-slate-500">
          Selecciona un componente para analizar qué se rompe si lo cambias.
        </p>
        <RagCostEstimatorCard />
      </div>
    );
  }

  const direct = outgoing.filter((item) => item.depth === 1).length;
  const risk = overallRisk(direct, outgoing.length - direct, incoming.length);
  const origin = modulesById?.get(sourceId) ?? null;

  return (
    <div className="flex min-h-full flex-col gap-3 bg-slate-50/60 px-4 py-3">
      <dl aria-label="Riesgo y rendimiento" className="@container">
        <div className="grid grid-cols-2 gap-2 @sm:grid-cols-4">
          <KpiCell
            label="Riesgo"
            hint={summary?.label ?? "Ningún módulo impactado"}
            detail={`${outgoing.length} exporta / ${incoming.length} consume${incoming.length === 1 ? "" : "n"}`}
          >
            <span className={cn("size-2 shrink-0 rounded-full", RISK_DOT[risk.level])} aria-hidden />
            <span className="truncate" title={risk.label}>
              {RISK_SHORT[risk.level]}
            </span>
          </KpiCell>
          {metricsScenario ? <ComponentMetricsKpis scenario={metricsScenario} nodeId={sourceId} /> : null}
        </div>
      </dl>

      <section aria-label="Dependencias y contratos" className={cn(CARD, "flex flex-col gap-3 p-3")}>
        <ImpactGroup
          key={`in-${sourceId}`}
          title="Llamado por"
          icon={ArrowDownLeft}
          direction="incoming"
          items={incoming}
          empty="Nadie lo llama dentro del mapa."
        />
        <ImpactGroup
          key={`out-${sourceId}`}
          title="Afecta a"
          icon={ArrowUpRight}
          direction="outgoing"
          items={outgoing}
          empty="No envía datos a otros módulos."
        />
      </section>

      {origin ? (
        <ChangeBriefCard
          key={sourceId}
          origin={origin}
          outgoing={outgoing}
          callers={incoming.map((item) => item.module)}
          riskLabel={risk.label}
        />
      ) : null}

      <RagCostEstimatorCard />

      <button
        type="button"
        onClick={() => useCanvasStore.getState().clearImpact()}
        className="mt-auto self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-accent"
      >
        Salir del análisis
      </button>
    </div>
  );
}
