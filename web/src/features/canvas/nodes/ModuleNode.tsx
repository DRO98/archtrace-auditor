import { memo, useEffect, useMemo } from "react";
import { Handle, Position, useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Cpu, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { isCanvasComponent } from "../edit/components";
import type { ModuleFlowNode, SlotHandle } from "../lib/flow";
import { PORT_POSITION, PORT_SIDES, portHandleId, type PortSide } from "../lib/ports";
import { useCanvasStore } from "../store";
import { CARD_HEIGHT, CARD_WIDTH, GROUP_STYLES, ROLE_TONE, supportHandlePercent } from "../theme";
import { formatLatency } from "@/features/playground/lib/traceState";
import { ModuleIcon } from "./ModuleIcon";
import { NodeActions } from "./NodeActions";
import { DIFF_RING, NodeOverlays, useNodeDiff, useNodeSlaBreach } from "./NodeOverlays";

const HANDLE = "size-2.5! rounded-full! border-2! border-white! bg-neutral-400! hover:bg-ink!";
/** Ranura de un cable: más pequeña, porque en un lado puede haber varias a pocos píxeles. */
const SLOT_HANDLE = "size-2! min-w-0! min-h-0! rounded-full! border! border-white! bg-neutral-400!";
const HIDDEN_HANDLE = "size-2.5! opacity-0! pointer-events-none!";
/** Sin puertos asignados (grafo plano) se conserva el contrato antiguo: entra por la izquierda, sale por la derecha. */
const DEFAULT_PORTS: readonly PortSide[] = ["left", "right"];
// El primer handle de cada tipo es el que React Flow usa para aristas sin `sourceHandle`/`targetHandle`.
const TARGET_ORDER: readonly PortSide[] = ["left", ...PORT_SIDES.filter((side) => side !== "left")];
const SOURCE_ORDER: readonly PortSide[] = ["right", ...PORT_SIDES.filter((side) => side !== "right")];
const DIAMOND =
  "size-3! rounded-none! border-0! bg-neutral-400! [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

function ModuleNodeComponent({ id, data }: NodeProps<ModuleFlowNode>) {
  const selected = useCanvasStore((s) => s.selectedModuleId === id);
  const ideHere = useCanvasStore((s) => s.activeModuleId === id);
  const lessonFocus = useCanvasStore((s) => s.lessonFocusIds.has(id));
  const spotlit = useCanvasStore((s) => s.spotlightId === id);
  const synced = useCanvasStore((s) => s.syncedIds.has(id));
  const virtual = isCanvasComponent(id);
  const dimmed = useCanvasStore((s) => s.match !== null && !s.match.modules.has(id));
  const compact = useStore((s) => s.transform[2] < 0.45);
  const diff = useNodeDiff(id);
  const slaBreach = useNodeSlaBreach(id);
  const { module: codeModule, role, subtitle, groupColor, groupLabel, supports, impact = "idle", impactDepth, sim, latencyMs, llmModel, ports, handles } = data;
  const tone = ROLE_TONE[role];
  const slotHandles = handles ?? [];
  // Con ranuras, los handles de lado solo quedan como respaldo invisible para aristas sin `sourceHandle`.
  const used = new Set(slotHandles.length > 0 ? [] : (ports ?? DEFAULT_PORTS));
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = useMemo(() => (handles ?? []).map((item) => `${item.type}:${item.id}:${item.percent}`).join("|"), [handles]);
  // React Flow mide los handles al montar el nodo: si el grafo cambia las ranuras, hay que volver a medirlas.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  return (
    <article
      data-module={id}
      aria-label={codeModule.label}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={cn(
        "group relative rounded-xl border bg-white shadow-md transition-[opacity,box-shadow] duration-200 hover:shadow-lg",
        tone.border,
        virtual && "border-dashed border-teal-400 bg-teal-50/40",
        synced && "ring-2 ring-sky-400",
        impact === "direct" && "border-orange-400",
        impact === "cascade" && "border-amber-600/70",
        (dimmed || impact === "dim") && "opacity-25 transition-opacity duration-300",
        selected && impact !== "origin" && "ring-2 ring-accent",
        impact === "origin" && "ring-4 ring-amber-400 animate-pulse",
        lessonFocus && impact === "idle" && "ring-2 ring-sky-500 shadow-lg",
        sim === "active" && "step-node-active ring-2 ring-teal-500 shadow-xl",
        sim === "done" && "border-teal-300",
        sim === "preview" && "ring-2 ring-teal-500 shadow-lg",
        sim === "off" && "opacity-40",
        spotlit && "node-spotlight z-10 ring-2 ring-teal-500 shadow-xl opacity-100",
        slaBreach && !diff && "border-amber-400",
        diff && DIFF_RING[diff],
      )}
    >
      {TARGET_ORDER.map((side) => (
        <Handle
          key={`target-${side}`}
          type="target"
          id={portHandleId(side)}
          position={PORT_POSITION[side]}
          className={used.has(side) ? HANDLE : HIDDEN_HANDLE}
        />
      ))}

      <div className="flex h-full items-center gap-3 px-4">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", tone.tile)} aria-hidden>
          <ModuleIcon role={role} filePath={codeModule.filePath} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-ink">{codeModule.label}</h3>
          {compact ? null : <p title={subtitle} className="truncate text-xs leading-4 text-ink-2">{subtitle}</p>}
        </div>
      </div>

      <span
        title={groupLabel}
        className={cn("absolute right-3 top-3 size-2 rounded-full", GROUP_STYLES[groupColor].dot)}
      />
      {llmModel ? (
        <span
          title="Modelo asignado · clic derecho para cambiarlo"
          className="absolute -top-3 left-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-teal-700 shadow-sm"
        >
          <Cpu className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{llmModel}</span>
        </span>
      ) : null}
      {virtual ? (
        <span className="absolute -top-3 right-6 rounded-full border border-teal-200 bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
          Añadido
        </span>
      ) : null}
      {synced ? (
        <span
          title="Código actualizado desde el IDE"
          className="absolute -bottom-3 left-3 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700"
        >
          <RefreshCw className="size-3" aria-hidden />
          Sincronizado
        </span>
      ) : null}
      {ideHere ? (
        <span
          title="El cursor del IDE está aquí"
          className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      ) : null}

      {supports.map((support, index) => (
        <Handle
          key={support.id}
          type="source"
          position={Position.Bottom}
          id={`support:${support.id}`}
          isConnectable={false}
          style={{ left: `${supportHandlePercent(index, supports.length)}%` }}
          className={DIAMOND}
        />
      ))}
      {slotHandles.map((slot) => (
        <Handle
          key={`${slot.type}-${slot.id}`}
          type={slot.type}
          id={slot.id}
          position={PORT_POSITION[slot.side]}
          isConnectable={false}
          style={slotStyle(slot)}
          className={SLOT_HANDLE}
        />
      ))}
      {SOURCE_ORDER.map((side) => (
        <Handle
          key={`source-${side}`}
          type="source"
          id={portHandleId(side)}
          position={PORT_POSITION[side]}
          className={used.has(side) ? HANDLE : HIDDEN_HANDLE}
        />
      ))}

      {impact === "direct" ? (
        <span className="absolute -bottom-3 left-3 inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          Impacto directo
        </span>
      ) : null}
      {impact === "cascade" ? (
        <span className="absolute -bottom-3 left-3 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          Nivel {impactDepth ?? 2}
        </span>
      ) : null}

      {latencyMs !== undefined ? (
        <span
          title="Latencia medida en la consulta en vivo"
          className="absolute -bottom-3 right-3 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-teal-700"
        >
          {formatLatency(latencyMs)}
        </span>
      ) : null}

      <NodeOverlays id={id} />
      {compact ? null : <NodeActions moduleId={id} selected={selected} />}
    </article>
  );
}

function slotStyle(slot: SlotHandle) {
  return slot.side === "left" || slot.side === "right" ? { top: `${slot.percent}%` } : { left: `${slot.percent}%` };
}

export const ModuleNode = memo(ModuleNodeComponent);
