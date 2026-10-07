"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Crosshair, FileText, FileX, Layers, Lock, MapPinOff, Network, RefreshCw, Repeat2, Unlink, type LucideIcon } from "lucide-react";
import type { CodeModule } from "@core/graph";
import { useBillingHydration, useIsPro } from "@/features/billing/store";
import { FREE_FINDINGS_LIMIT } from "@/features/billing/quota";
import { roleForPath } from "@/features/canvas/lib/architecture";
import { useCanvasStore } from "@/features/canvas/store";
import { ROLE_LABEL } from "@/features/canvas/theme";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { useBriefSeed } from "@/features/drawer/briefStore";
import { useLessonStore } from "@/features/lesson/store";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { uiLanguage, type UiLanguage } from "@/lib/i18n/lang";
import { cn } from "@/lib/cn";
import { isDriftFinding, splitForPlan, type Finding, type FindingKind, type FindingSeverity } from "./lib/architectureCheck";
import { runArchitectureCheck, useHealth } from "./store";

/** Textos del panel y del banner de drift: bilingües como los hallazgos (el resto del lienzo sigue en español). */
export const CHECK_COPY = {
  es: {
    title: "Architecture Check",
    rescan: "Re-scan",
    rescanHint: "Recalcula los hallazgos (y relee el código si el IDE está conectado)",
    summary: (count: number, ms: number | null) => `${count} hallazgo${count === 1 ? "" : "s"}${ms !== null ? ` · ${ms} ms` : ""}`,
    empty: "Sin ciclos, hubs críticos, capas invertidas ni drift en este grafo.",
    noSource: "Sin mapa del IDE: el drift solo cubre módulos huérfanos. Conecta el IDE y pulsa Re-scan para compararlo con el código.",
    spotlight: "Destacar en el lienzo",
    brief: "Crear brief",
    briefHint: "Abre Impacto sobre este módulo con el brief prellenado",
    why: "Por qué importa",
    fix: "Qué hacer",
    more: "Ver más",
    less: "Ver menos",
    kinds: {
      cycle: "Ciclo",
      "god-node": "Hub",
      "layer-inversion": "Capas",
      "drift-disconnected": "Huérfano",
      "drift-unmapped": "Sin mapear",
      "drift-stale": "Obsoleto",
    },
    severity: { high: "Grave", medium: "Media", low: "Baja" },
    groups: { graph: "Grafo", drift: "Drift con el código" },
    groupHints: { graph: "Ciclos, hubs y capas invertidas", drift: "Lo que el mapa y el código no comparten" },
    locked: (count: number) => `${count} hallazgo${count === 1 ? "" : "s"} más con Pro`,
    unlock: "Desbloquear con Pro",
    drift: (unmapped: number, stale: number) =>
      [unmapped > 0 ? `${unmapped} sin mapear` : null, stale > 0 ? `${stale} ya no existe${stale === 1 ? "" : "n"}` : null].filter(Boolean).join(" · "),
    driftTitle: "El mapa ya no cuadra con el código",
    orphans: (count: number) =>
      count === 1 ? "1 módulo sin dependencias, oculto en el lienzo" : `${count} módulos sin dependencias en el mapa, ocultos en el lienzo`,
    open: "Ver en Architecture Check",
    dismiss: "Ocultar aviso",
    run: (count: number) => `Ejecutar Architecture Check${count > 0 ? ` · ${count} hallazgo${count === 1 ? "" : "s"} a revisar` : ""}`,
  },
  en: {
    title: "Architecture Check",
    rescan: "Re-scan",
    rescanHint: "Recompute findings (and re-read the code if the IDE is connected)",
    summary: (count: number, ms: number | null) => `${count} finding${count === 1 ? "" : "s"}${ms !== null ? ` · ${ms} ms` : ""}`,
    empty: "No cycles, critical hubs, layer inversions or drift in this graph.",
    noSource: "No IDE map: drift only covers orphan modules. Connect the IDE and hit Re-scan to compare with the code.",
    spotlight: "Highlight on canvas",
    brief: "Create brief",
    briefHint: "Open Impact on this module with the brief pre-filled",
    why: "Why it matters",
    fix: "What to do",
    more: "Show more",
    less: "Show less",
    kinds: {
      cycle: "Cycle",
      "god-node": "Hub",
      "layer-inversion": "Layers",
      "drift-disconnected": "Orphan",
      "drift-unmapped": "Unmapped",
      "drift-stale": "Stale",
    },
    severity: { high: "High", medium: "Medium", low: "Low" },
    groups: { graph: "Graph", drift: "Drift vs. code" },
    groupHints: { graph: "Cycles, hubs and layer inversions", drift: "What the map and the code disagree on" },
    locked: (count: number) => `${count} more finding${count === 1 ? "" : "s"} with Pro`,
    unlock: "Unlock with Pro",
    drift: (unmapped: number, stale: number) =>
      [unmapped > 0 ? `${unmapped} not on the map` : null, stale > 0 ? `${stale} no longer exist${stale === 1 ? "s" : ""}` : null].filter(Boolean).join(" · "),
    driftTitle: "The map no longer matches the code",
    orphans: (count: number) =>
      count === 1 ? "1 module with no dependencies, hidden on the canvas" : `${count} modules with no dependencies on the map, hidden on the canvas`,
    open: "View in Architecture Check",
    dismiss: "Hide notice",
    run: (count: number) => `Run Architecture Check${count > 0 ? ` · ${count} finding${count === 1 ? "" : "s"} to review` : ""}`,
  },
} as const;

export function checkCopy(lang: UiLanguage = uiLanguage()) {
  return CHECK_COPY[lang];
}

type CheckCopy = ReturnType<typeof checkCopy>;

const SEVERITY_CHIP: Readonly<Record<FindingSeverity, string>> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-neutral-200 bg-neutral-50 text-ink-3",
};

/** Borde izquierdo de la tarjeta: la gravedad se lee sin leer el chip. */
const SEVERITY_EDGE: Readonly<Record<FindingSeverity, string>> = {
  high: "border-l-rose-500",
  medium: "border-l-amber-500",
  low: "border-l-neutral-300",
};

const KIND_ICON: Readonly<Record<FindingKind, LucideIcon>> = {
  cycle: Repeat2,
  "god-node": Network,
  "layer-inversion": Layers,
  "drift-disconnected": Unlink,
  "drift-unmapped": MapPinOff,
  "drift-stale": FileX,
};

const ACTION =
  "inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-neutral-100";

/** Número del badge de la barra lateral: hallazgos graves más drift de código (sin mapear / ya no existe). */
export function useCheckBadge(): number {
  return useHealth((state) => state.findings.filter((item) => item.severity === "high" || item.kind === "drift-unmapped" || item.kind === "drift-stale").length);
}

function focusFinding(finding: Finding): void {
  const moduleId = finding.moduleIds[0];
  if (!moduleId || finding.kind === "drift-disconnected") return;
  const canvas = useCanvasStore.getState();
  canvas.selectModule(moduleId);
  canvas.spotlight(moduleId);
}

function createBrief(finding: Finding): void {
  const moduleId = finding.moduleIds[0];
  if (!moduleId) return;
  useBriefSeed.getState().setSeed({ moduleId, findingId: finding.id, title: finding.title, fixHint: finding.fixHint });
  const canvas = useCanvasStore.getState();
  canvas.setPopover(null);
  canvas.startImpact(moduleId);
}

/** Rol, ruta y subtítulo de un módulo huérfano: el lienzo lo oculta, así que la tarjeta dice qué es. */
function OrphanCard({ module }: { module: CodeModule }) {
  const role = module.role ?? roleForPath(module.filePath);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-neutral-50 px-2 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 rounded bg-white px-1.5 py-px text-[10px] font-medium text-ink-2 ring-1 ring-line">{ROLE_LABEL[role]}</span>
        <span className="truncate text-xs font-medium text-ink">{module.label}</span>
      </span>
      {module.subtitle ? <span className="truncate text-[11px] text-ink-3">{module.subtitle}</span> : null}
      <span className="truncate font-mono text-[10px] text-ink-3" title={module.filePath}>
        {module.filePath}
      </span>
    </div>
  );
}

function FindingRow({ finding, copy }: { finding: Finding; copy: CheckCopy }) {
  const [open, setOpen] = useState(false);
  const moduleId = finding.moduleIds[0];
  const orphan = useCanvasStore((state) =>
    finding.kind === "drift-disconnected" && moduleId ? state.indexes?.modulesById.get(moduleId) : undefined,
  );
  // Los huérfanos no se pintan (el lienzo los oculta) y lo "sin mapear" no tiene nodo: nada que destacar.
  const onCanvas = moduleId !== undefined && finding.kind !== "drift-disconnected";
  const Icon = KIND_ICON[finding.kind];
  return (
    <li className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-l-[3px] border-line bg-white px-2.5 py-2", SEVERITY_EDGE[finding.severity])}>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-ink-2">
          <Icon className="size-3" aria-hidden />
          {copy.kinds[finding.kind]}
        </span>
        <span className={cn("rounded border px-1.5 py-px text-[10px] font-medium", SEVERITY_CHIP[finding.severity])}>{copy.severity[finding.severity]}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="ml-auto inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-ink-3 hover:bg-neutral-100 hover:text-ink"
        >
          {open ? copy.less : copy.more}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      {onCanvas ? (
        <button
          type="button"
          onClick={() => focusFinding(finding)}
          title={copy.spotlight}
          className="text-left text-xs font-medium leading-snug text-ink [overflow-wrap:anywhere] hover:underline"
        >
          {finding.title}
        </button>
      ) : (
        <p className="text-xs font-medium leading-snug text-ink [overflow-wrap:anywhere]">{finding.title}</p>
      )}

      {orphan ? <OrphanCard module={orphan} /> : null}

      <dl className="flex flex-col gap-1 text-[11px] leading-snug">
        <div>
          <dt className="font-semibold text-ink-2">{copy.why}</dt>
          <dd className={cn("text-ink-3", !open && "line-clamp-2")}>{finding.why}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-2">{copy.fix}</dt>
          <dd className={cn("text-ink-3", !open && "line-clamp-1")}>{finding.fixHint}</dd>
        </div>
      </dl>

      {moduleId ? (
        <div className="flex flex-wrap gap-1.5">
          {onCanvas ? (
            <button type="button" onClick={() => focusFinding(finding)} className={ACTION}>
              <Crosshair className="size-3" aria-hidden />
              {copy.spotlight}
            </button>
          ) : null}
          <button type="button" onClick={() => createBrief(finding)} title={copy.briefHint} className={ACTION}>
            <FileText className="size-3" aria-hidden />
            {copy.brief}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function FindingGroup({ group, findings, copy }: { group: "graph" | "drift"; findings: readonly Finding[]; copy: CheckCopy }) {
  if (findings.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5" aria-label={copy.groups[group]}>
      <header className="flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          {copy.groups[group]} · {findings.length}
        </h3>
        <span className="truncate text-[10px] text-ink-3">{copy.groupHints[group]}</span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} copy={copy} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Architecture Check: hallazgos del grafo (ciclos, hubs, capas invertidas) y drift con el código, en una sola
 * lista agrupada (Grafo / Drift) y ordenada por gravedad. Cada hallazgo es una tarjeta con qué es, por qué importa
 * y qué hacer; «Destacar» selecciona el módulo y «Crear brief» abre Impacto con el prompt prellenado.
 */
export function ArchitectureCheckPanel() {
  const findings = useHealth((state) => state.findings);
  const checkMs = useHealth((state) => state.checkMs);
  const checkedSource = useHealth((state) => state.drift?.checkedSource ?? false);
  const connected = useTeacherStatus() === "open";
  useBillingHydration();
  const pro = useIsPro();
  const [scanning, setScanning] = useState(false);
  const copy = checkCopy();
  const { visible, locked } = splitForPlan(findings, pro ? Number.POSITIVE_INFINITY : FREE_FINDINGS_LIMIT);

  async function rescan(): Promise<void> {
    setScanning(true);
    try {
      // Con el IDE conectado se relee el código (el drift cambia y el check se recalcula solo); si no, solo el grafo.
      if (connected) await useLessonStore.getState().refreshMap({ quiet: true }).catch(() => null);
      runArchitectureCheck();
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 overflow-x-hidden p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-3">{copy.summary(findings.length, checkMs)}</p>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void rescan()}
          title={copy.rescanHint}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink-2 hover:bg-neutral-50 disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} aria-hidden />
          {copy.rescan}
        </button>
      </div>
      {!checkedSource ? <p className="text-[11px] leading-snug text-ink-3">{copy.noSource}</p> : null}
      {findings.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
          {copy.empty}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <FindingGroup group="graph" findings={visible.filter((finding) => !isDriftFinding(finding))} copy={copy} />
          <FindingGroup group="drift" findings={visible.filter(isDriftFinding)} copy={copy} />
        </div>
      )}
      {locked > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-teal-300 bg-teal-50/60 px-2.5 py-2">
          <span className="flex items-center gap-1.5 text-[11px] text-teal-900">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {copy.locked(locked)}
          </span>
          <Link href={DASHBOARD_ROUTES.settings} className="shrink-0 rounded-md bg-teal-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-800">
            {copy.unlock}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
