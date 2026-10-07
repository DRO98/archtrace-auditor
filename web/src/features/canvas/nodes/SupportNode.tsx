import { memo } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SupportFlowNode } from "../lib/flow";
import { useCanvasStore } from "../store";
import { ROLE_TONE, SUPPORT_SIZE } from "../theme";
import { formatLatency } from "@/features/playground/lib/traceState";
import { ModuleIcon } from "./ModuleIcon";
import { NodeActions } from "./NodeActions";
import { DIFF_RING, NodeOverlays, useNodeDiff } from "./NodeOverlays";

const DIAMOND =
  "size-3! rounded-none! border-0! bg-neutral-400! [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

function SupportNodeComponent({ id, data }: NodeProps<SupportFlowNode>) {
  const selected = useCanvasStore((s) => s.selectedModuleId === id);
  const ideHere = useCanvasStore((s) => s.activeModuleId === id);
  const lessonFocus = useCanvasStore((s) => s.lessonFocusIds.has(id));
  const spotlit = useCanvasStore((s) => s.spotlightId === id);
  const dimmed = useCanvasStore((s) => s.match !== null && !s.match.modules.has(id));
  const compact = useStore((s) => s.transform[2] < 0.45);
  const diff = useNodeDiff(id);
  const { module: codeModule, role, subtitle, impact = "idle", impactDepth, sim, latencyMs } = data;
  const tone = ROLE_TONE[role];

  return (
    <div className="group relative" style={{ width: SUPPORT_SIZE, height: SUPPORT_SIZE }}>
      <div
        data-module={id}
        aria-label={codeModule.label}
        title={subtitle}
        className={cn(
          "grid size-14 place-items-center rounded-full border shadow-md transition-[opacity,box-shadow] duration-200 hover:shadow-lg",
          tone.tile,
          tone.border,
          impact === "direct" && "border-orange-400",
          impact === "cascade" && "border-amber-600/70",
          (dimmed || impact === "dim") && "opacity-25 transition-opacity duration-300",
          selected && impact !== "origin" && "ring-2 ring-accent",
          impact === "origin" && "ring-4 ring-amber-400 animate-pulse",
          lessonFocus && impact === "idle" && "ring-2 ring-sky-500",
          sim === "active" && "step-node-active ring-2 ring-teal-500 shadow-xl",
          sim === "done" && "border-teal-300",
          sim === "preview" && "ring-2 ring-teal-500 shadow-lg",
          sim === "off" && "opacity-40",
          spotlit && "node-spotlight ring-2 ring-teal-500 shadow-xl opacity-100",
          diff && DIFF_RING[diff],
        )}
      >
        <ModuleIcon role={role} filePath={codeModule.filePath} className="size-6" />
      </div>
      <NodeOverlays id={id} compact />
      {ideHere ? (
        <span
          title="El cursor del IDE está aquí"
          className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      ) : null}
      {compact ? null : (
        <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-24 -translate-x-1/2 text-center text-[11px] font-medium leading-tight text-ink-2 line-clamp-2">
          {codeModule.label}
        </span>
      )}
      <Handle type="target" position={Position.Top} id="in" isConnectable={false} className={DIAMOND} />
      {impact === "direct" ? (
        <span className="absolute -bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          Impacto directo
        </span>
      ) : null}
      {impact === "cascade" ? (
        <span className="absolute -bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          Nivel {impactDepth ?? 2}
        </span>
      ) : null}
      {latencyMs !== undefined ? (
        <span
          title="Latencia medida en la consulta en vivo"
          className="absolute -right-3 -top-2 z-10 whitespace-nowrap rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-700"
        >
          {formatLatency(latencyMs)}
        </span>
      ) : null}
      {compact ? null : <NodeActions moduleId={id} selected={selected} />}
    </div>
  );
}

export const SupportNode = memo(SupportNodeComponent);
