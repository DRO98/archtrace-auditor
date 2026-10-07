import { memo } from "react";
import Image from "next/image";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Activity, Bot, Boxes, ChevronRight, Database, MessageSquare, Monitor, Radio, Server, Waves, Workflow, Zap, type LucideIcon } from "lucide-react";
import type { GroupColor, ModuleRole } from "@core/graph";
import { BrandIcon } from "@/components/icons/BrandIcon";
import { blockLogo, readableHex } from "@/components/icons/stackLogos";
import { cn } from "@/lib/cn";
import type { SubsystemFlowNode, SubsystemNodeData } from "../lib/flow";
import { FACET_ROW_HEIGHT, LEVEL0_NODE_HEIGHT } from "../lib/level0";
import { useCanvasStore } from "../store";
import { GROUP_STYLES, ROLE_LABEL } from "../theme";

/** Fondo translúcido + borde de color: la caja se lee como "zona" con identidad propia, no como otra tarjeta. */
const BOX_TONE: Record<GroupColor, string> = {
  sky: "border-sky-300 bg-sky-50/60",
  emerald: "border-emerald-300 bg-emerald-50/60",
  violet: "border-violet-300 bg-violet-50/60",
  amber: "border-amber-300 bg-amber-50/60",
  rose: "border-rose-300 bg-rose-50/60",
  zinc: "border-neutral-300 bg-neutral-100/70",
};

/** Borde de color del nodo de Level 0 (fondo blanco: el color es identidad, no relleno). */
const BORDER_TONE: Record<GroupColor, string> = {
  sky: "border-sky-300",
  emerald: "border-emerald-300",
  violet: "border-violet-300",
  amber: "border-amber-300",
  rose: "border-rose-300",
  zinc: "border-neutral-300",
};

const HIDDEN_HANDLE = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

/** Icono por rol: se lee como un diagrama de sistema (base de datos, cola, API, LLM…), no como una carpeta. */
const ROLE_ICON: Partial<Record<ModuleRole, LucideIcon>> = {
  api: Server,
  rpc: Server,
  database: Database,
  cache: Zap,
  broker: Radio,
  stream: Waves,
  pipeline: Workflow,
  "ai-model": Bot,
  prompt: MessageSquare,
  ui: Monitor,
  app: Monitor,
  util: Activity,
};

const ICON_TONE: Record<GroupColor, string> = {
  sky: "bg-sky-100 text-sky-700",
  emerald: "bg-emerald-100 text-emerald-700",
  violet: "bg-violet-100 text-violet-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  zinc: "bg-neutral-200 text-neutral-700",
};

/**
 * Nodo de Level 0, compacto como una caja C4/Mermaid: logo (o icono del rol) + nombre corto. El detalle crece con el
 * zoom (`archResolution`): lejos solo el nombre; a zoom normal la tecnología o el papel; de cerca, sus abstracciones.
 * En la vista «Arquitectura» (`expanded`) el nodo se despliega y lista sus componentes. Click → detalle (o selecciona
 * el módulo si el nodo es solo infraestructura, p. ej. MongoDB).
 */
function Level0Block({ data, width, height }: { data: SubsystemNodeData & { level0: NonNullable<SubsystemNodeData["level0"]> }; width?: number; height?: number }) {
  const resolution = useCanvasStore((state) => state.archResolution);
  const { size, sample, tech, techIds, summary, role, kind, primaryModuleId, facets } = data.level0;
  const Icon = ROLE_ICON[role] ?? Boxes;
  // Logo oficial (ver `blockLogo`): la propia tecnología en la infra, la primera con logo en un servicio. Sin logo
  // oficial, el icono del rol.
  const logo = blockLogo({ kind, techIds, label: data.label, ...(data.level0.logoModuleId ? { primaryModuleId: data.level0.logoModuleId } : {}) });
  const logoSize = resolution === 0 ? 28 : 24;
  // Un servicio de infra ya se llama como su tecnología: su chip dice qué papel juega (cola, base de datos…).
  const chip = kind === "infra" ? ROLE_LABEL[role] : tech[0];
  const single = primaryModuleId !== undefined;
  // Lo que se ve de cerca: las abstracciones del servicio; en los bloques por carpeta, sus módulos más conectados.
  const detail = facets.length > 0 ? facets : sample;
  // Vista «Arquitectura»: el nodo se despliega y lista sus abstracciones debajo de la cabecera.
  const expanded = data.level0.expanded === true && facets.length > 0;
  return (
    <div
      role="button"
      aria-label={single ? `${data.label}. Ver detalles` : `${data.label}. Abrir detalle (${size} módulos)`}
      title={summary ? `${data.label} — ${summary}` : data.label}
      className={cn(
        "group flex cursor-pointer flex-col rounded-xl border-2 bg-white px-3 shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        BORDER_TONE[data.color],
        kind === "part" && "border-dashed",
        data.dimmed && "opacity-25",
        data.sim === "active" && "step-node-active border-teal-500 shadow-xl ring-2 ring-teal-500",
        data.sim === "done" && "border-teal-300",
        data.sim === "preview" && "ring-2 ring-teal-500 shadow-lg",
        data.sim === "off" && "opacity-40",
      )}
      style={{ width, height }}
    >
      <Handle type="target" position={Position.Left} className={HIDDEN_HANDLE} isConnectable={false} />
      <div className="flex shrink-0 items-center gap-3" style={{ height: LEVEL0_NODE_HEIGHT - 4 }}>
        {logo ? (
          <span className={cn("grid shrink-0 place-items-center rounded-lg bg-white ring-1 ring-line", resolution === 0 ? "size-12" : "size-10")} title={logo.title} aria-hidden>
            {logo.kind === "glyph" ? (
              <BrandIcon icon={{ path: logo.path, hex: readableHex(logo.hex) }} className={resolution === 0 ? "size-7" : "size-6"} />
            ) : (
              <Image src={logo.src} alt="" width={logoSize} height={logoSize} unoptimized />
            )}
          </span>
        ) : (
          <span className={cn("grid shrink-0 place-items-center rounded-lg", ICON_TONE[data.color], resolution === 0 ? "size-12" : "size-10")} aria-hidden>
            <Icon className={resolution === 0 ? "size-6" : "size-5"} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className={cn("line-clamp-2 font-semibold leading-tight text-ink [overflow-wrap:anywhere]", resolution === 0 ? "text-lg" : "text-[15px]")}>
            {data.label}
          </h3>
          {resolution >= 1 ? (
            <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
              {chip ? <span className="truncate rounded bg-neutral-100 px-1.5 py-px font-medium text-ink-2">{chip}</span> : null}
            </p>
          ) : null}
          {resolution === 2 && !single && !expanded && detail.length > 0 ? <p className="truncate text-[11px] text-ink-3">{detail.join(" · ")}</p> : null}
        </div>
        {single ? null : <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </div>
      {expanded ? (
        <ul className="flex flex-col border-t border-line pt-1" aria-label={`Componentes de ${data.label}`}>
          {facets.map((facet) => (
            <li key={facet} className="flex items-center gap-2 text-xs text-ink-2" style={{ height: FACET_ROW_HEIGHT }}>
              <span className={cn("size-1.5 shrink-0 rounded-full", GROUP_STYLES[data.color].dot)} aria-hidden />
              <span className="truncate">{facet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Handle type="source" position={Position.Right} className={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}

function SubsystemNodeComponent({ data, width, height }: NodeProps<SubsystemFlowNode>) {
  const style = GROUP_STYLES[data.color];
  if (data.level0) return <Level0Block data={{ ...data, level0: data.level0 }} width={width} height={height} />;
  return (
    <div
      role="group"
      aria-label={data.label}
      className={cn(
        "pointer-events-none rounded-2xl border-2 shadow-sm transition-opacity duration-300",
        BOX_TONE[data.color],
        data.dimmed && "opacity-25",
      )}
      style={{ width, height }}
    >
      <span
        className={cn(
          "absolute left-4 top-3 inline-flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold uppercase tracking-wide shadow-sm",
          style.chip,
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden />
        <span className="truncate">{data.label}</span>
      </span>
    </div>
  );
}

export const SubsystemNode = memo(SubsystemNodeComponent);
