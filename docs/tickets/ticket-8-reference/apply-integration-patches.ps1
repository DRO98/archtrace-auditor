<#
.SYNOPSIS
  Aplica al codigo EXISTENTE los cambios minimos del Ticket 8 (integracion de la simulacion).

.DESCRIPTION
  Cada cambio es "reemplaza este fragmento exacto por este otro". Es atomico por grupo:
  si un fragmento ya no existe o aparece mas de una vez (porque alguien edito el archivo),
  NO se escribe nada de ese grupo y se listan los fallos. En ese caso, aplica ese cambio a mano
  siguiendo la intencion descrita en docs/tickets/TICKET-8.md.

  Grupos (uno por paso del runbook):
    foundation  core/index.ts, package.json, globals.css, store del canvas (pestana "flow")
    edges       flow.ts (aristas de apoyo) y RoutedEdge.tsx (paquete animado)
    nodes       ModuleNode.tsx y SupportNode.tsx (estado de simulacion)
    shell       CanvasView, AppHeader, CanvasApp, IdeSyncBridge
    drawer      StepTimeline y TeacherDrawer (pestana Flujo)

.EXAMPLE
  powershell -File apply-integration-patches.ps1 -Group edges -Check   # solo comprobar
  powershell -File apply-integration-patches.ps1 -Group edges          # aplicar
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("foundation", "edges", "nodes", "shell", "drawer")]
  [string]$Group,
  [switch]$Check,
  [switch]$Force,
  [string]$Root = "C:\Users\alexc\OneDrive\Documentos\TEACHER"
)

$ErrorActionPreference = "Stop"

# OBSOLETO. Ver README.md de esta carpeta: este script codifica un diseno anterior al lienzo por capas
# (selectores de simulacion dentro de cada nodo, reproductor arriba, 4x, toggles de IDE/camara) y
# contradice las decisiones de docs/tickets/TICKET-8.md. Usa TICKET-8.md como plan.
if (-not $Force) {
  Write-Host "OBSOLETO: este script contradice docs/tickets/TICKET-8.md (ver README.md de esta carpeta). No se ha hecho nada. Usa -Force solo si sabes lo que haces." -ForegroundColor Yellow
  exit 2
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$web = Join-Path $Root "web\src"
$canvas = Join-Path $web "features\canvas"
$ops = New-Object System.Collections.Generic.List[object]

function Add-Op([string]$file, [string]$old, [string]$new) {
  $ops.Add([pscustomobject]@{ File = $file; Old = $old; New = $new })
}

switch ($Group) {
  "foundation" {
    Add-Op (Join-Path $Root "core\src\index.ts") 'export type * from "./lesson.js";' "export type * from `"./lesson.js`";`nexport type * from `"./simulation.js`";"
    Add-Op (Join-Path $Root "web\package.json") '"graph:build":' "`"scenarios:build`": `"tsx scripts/build-sandbox-scenarios.ts`",`n    `"scenarios:validate`": `"tsx scripts/validate-scenarios.ts`",`n    `"graph:build`":"
    Add-Op (Join-Path $web "app\globals.css") '--color-accent: #ff6d5a;' "--color-flow: #7c3aed;        /* violet-600: simulación de flujo */`n  --color-accent: #ff6d5a;"
    Add-Op (Join-Path $canvas "store.ts") '"code" | "lesson" | "impact";' '"code" | "lesson" | "impact" | "flow";'
  }

  "edges" {
    Add-Op (Join-Path $canvas "lib\flow.ts") 'type: "smoothstep",' 'type: "support",'
    $edge = Join-Path $canvas "edges\RoutedEdge.tsx"
    Add-Op $edge 'import type { GraphPosition } from "../lib/layout";' @'
import { EdgePacket } from "@/features/simulation/components/EdgePacket";
import { simEdgeStyle } from "@/features/simulation/components/simEdgeStyle";
import { useSimStore } from "@/features/simulation/store";
import type { GraphPosition } from "../lib/layout";
import { SupportEdge } from "./SupportEdge";
'@.TrimEnd()
    Add-Op $edge 'const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style } = props;' @'
const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style } = props;
  const sim = useSimStore((state) => state.edgeStatus[id]);
'@.TrimEnd()
    Add-Op $edge '  return <BaseEdge path={routed ?? fallback} markerEnd={markerEnd} style={style} />;' @'
  const path = routed ?? fallback;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={simEdgeStyle(style, sim)} />
      <EdgePacket edgeId={id} path={path} />
    </>
  );
'@.TrimEnd()
    Add-Op $edge 'export const edgeTypes = { routed: RoutedEdge };' 'export const edgeTypes = { routed: RoutedEdge, support: SupportEdge };'
  }

  "nodes" {
    $module = Join-Path $canvas "nodes\ModuleNode.tsx"
    Add-Op $module 'import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";' "import { Handle, Position, useStore, type NodeProps } from `"@xyflow/react`";`nimport { Check } from `"lucide-react`";"
    Add-Op $module 'import { cn } from "@/lib/cn";' "import { cn } from `"@/lib/cn`";`nimport { useSimStore } from `"@/features/simulation/store`";"
    Add-Op $module '  const compact = useStore((s) => s.transform[2] < 0.45);' "  const compact = useStore((s) => s.transform[2] < 0.45);`n  const sim = useSimStore((s) => s.nodeStatus[id]);"
    Add-Op $module "      data-module={id}`n      aria-label={codeModule.label}" "      data-module={id}`n      data-sim={sim ?? `"idle`"}`n      aria-label={codeModule.label}"
    Add-Op $module "        lessonFocus && impact === `"idle`" && `"ring-2 ring-sky-500 shadow-lg`",`n      )}" @'
        lessonFocus && impact === "idle" && "ring-2 ring-sky-500 shadow-lg",
        sim === "active" && "ring-2 ring-flow shadow-[0_0_0_6px_rgba(124,58,237,0.14)]",
        sim === "done" && "border-violet-300",
        sim === "off" && "opacity-40",
      )}
'@.TrimEnd()
    Add-Op $module '      {ideHere ? (' @'
      {sim === "done" ? (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-violet-600 text-white ring-2 ring-white"
        >
          <Check className="size-3" />
        </span>
      ) : null}
      {ideHere ? (
'@.TrimEnd()

    $support = Join-Path $canvas "nodes\SupportNode.tsx"
    Add-Op $support 'import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";' "import { Handle, Position, useStore, type NodeProps } from `"@xyflow/react`";`nimport { Check } from `"lucide-react`";"
    Add-Op $support 'import { cn } from "@/lib/cn";' "import { cn } from `"@/lib/cn`";`nimport { useSimStore } from `"@/features/simulation/store`";"
    Add-Op $support '  const compact = useStore((s) => s.transform[2] < 0.45);' "  const compact = useStore((s) => s.transform[2] < 0.45);`n  const sim = useSimStore((s) => s.nodeStatus[id]);"
    Add-Op $support "        data-module={id}`n        aria-label={codeModule.label}" "        data-module={id}`n        data-sim={sim ?? `"idle`"}`n        aria-label={codeModule.label}"
    Add-Op $support "          lessonFocus && impact === `"idle`" && `"ring-2 ring-sky-500`",`n        )}" @'
          lessonFocus && impact === "idle" && "ring-2 ring-sky-500",
          sim === "active" && "ring-2 ring-flow shadow-[0_0_0_6px_rgba(124,58,237,0.14)]",
          sim === "done" && "border-violet-300",
          sim === "off" && "opacity-40",
        )}
'@.TrimEnd()
    Add-Op $support '      {ideHere ? (' @'
      {sim === "done" ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-violet-600 text-white ring-2 ring-white"
        >
          <Check className="size-3" />
        </span>
      ) : null}
      {ideHere ? (
'@.TrimEnd()
  }

  "shell" {
    $view = Join-Path $canvas "CanvasView.tsx"
    Add-Op $view 'import { ZoomControls } from "./components/ZoomControls";' "import { ZoomControls } from `"./components/ZoomControls`";`nimport { PlayerBar } from `"@/features/simulation/components/PlayerBar`";"
    Add-Op $view '        <ZoomControls />' "        <ZoomControls />`n        <PlayerBar />"

    $header = Join-Path $canvas "components\AppHeader.tsx"
    Add-Op $header 'import { ConnectionBadge } from "@/components/ConnectionBadge";' "import { ConnectionBadge } from `"@/components/ConnectionBadge`";`nimport { SimulateButton } from `"@/features/simulation/components/SimulateButton`";"
    Add-Op $header '      <div className="ml-auto flex items-center gap-3">' "      <div className=`"ml-auto flex items-center gap-3`">`n        <SimulateButton />"

    $app = Join-Path $canvas "CanvasApp.tsx"
    Add-Op $app @'
function graphNameFromLocation(): string {
  const raw = new URLSearchParams(window.location.search).get("graph");
  if (raw && /^[a-z0-9_-]+$/.test(raw)) return raw;
  return "macro_rag_project";
}


'@ ([string]::Empty)
    Add-Op $app 'import { useCanvasKeys } from "./lib/useCanvasKeys";' @'
import { graphNameFromLocation } from "./lib/graphName";
import { useCanvasKeys } from "./lib/useCanvasKeys";
import { SimulationBridge } from "@/features/simulation/SimulationBridge";
import { useScenarios } from "@/features/simulation/lib/useScenarios";
import { useSimStore } from "@/features/simulation/store";
'@.TrimEnd()
    Add-Op $app '  const flow = useMemo(() => layeredFlow(prepared, layout), [prepared, layout]);' @'
  const flow = useMemo(() => layeredFlow(prepared, layout), [prepared, layout]);
  const simNodeIds = useMemo(
    () => flow.nodes.filter((node) => !isSubsystemNode(node)).map((node) => node.id),
    [flow.nodes],
  );
  useScenarios(prepared.graph, flow.edges);
  useEffect(() => {
    useSimStore.getState().configure({ edges: flow.edges, nodeIds: simNodeIds });
  }, [flow.edges, simNodeIds]);
'@.TrimEnd()
    Add-Op $app '      <ExportDocsModal open={exportOpen} onClose={() => setExportOpen(false)} />' "      <ExportDocsModal open={exportOpen} onClose={() => setExportOpen(false)} />`n      <SimulationBridge />"

    $ide = Join-Path $canvas "IdeSyncBridge.tsx"
    Add-Op $ide 'import { useTeacherIdeState } from "@/hooks/useTeacherSocket";' "import { useTeacherIdeState } from `"@/hooks/useTeacherSocket`";`nimport { useSimStore } from `"@/features/simulation/store`";"
    Add-Op $ide 'if (followIde && moduleId && moduleId !== lastModuleId.current) {' @'
if (
      followIde &&
      moduleId &&
      moduleId !== lastModuleId.current &&
      useSimStore.getState().activeScenarioId === null // durante una simulación la cámara la lleva ella
    ) {
'@.TrimEnd()
  }

  "drawer" {
    $timeline = Join-Path $web "features\drawer\StepTimeline.tsx"
    Add-Op $timeline 'import { Check } from "lucide-react";' "import type { ReactNode } from `"react`";`nimport { Check } from `"lucide-react`";"
    Add-Op $timeline "  onOpenInIde: (index: number) => void;`n}" @'
  onOpenInIde: (index: number) => void;
  /** Texto accesible de la lista. Por defecto "Pasos de la lección". */
  label?: string;
  /** Contenido extra dentro de la tarjeta del paso activo (p. ej. datos de entrada y salida). */
  renderDetail?: (index: number) => ReactNode;
}
'@.TrimEnd()
    Add-Op $timeline 'export function StepTimeline({ steps, activeIndex, onSelect, onPrev, onNext, onOpenInIde }: StepTimelineProps) {' @'
export function StepTimeline({
  steps,
  activeIndex,
  onSelect,
  onPrev,
  onNext,
  onOpenInIde,
  label,
  renderDetail,
}: StepTimelineProps) {
'@.TrimEnd()
    Add-Op $timeline 'aria-label="Pasos de la lección"' 'aria-label={label ?? "Pasos de la lección"}'
    Add-Op $timeline "                    Ver en el IDE`n                  </button>" "                    Ver en el IDE`n                  </button>`n                  {renderDetail?.(index)}"

    $drawer = Join-Path $web "features\drawer\TeacherDrawer.tsx"
    Add-Op $drawer 'import { LessonTab } from "./LessonTab";' "import { LessonTab } from `"./LessonTab`";`nimport { FlowTab } from `"./FlowTab`";`nimport { useSimStore } from `"@/features/simulation/store`";"
    Add-Op $drawer "  const duration = useMotionDuration(300);`n`n  useEffect(() => {`n    if (!open || !moduleId) return;" @'
  const duration = useMotionDuration(300);
  const hasScenarios = useSimStore((state) => state.scenarios.length > 0);

  useEffect(() => {
    // En la pestaña Flujo la cámara la lleva la simulación: no se recoloca aquí.
    if (!open || !moduleId || tab === "flow") return;
'@.TrimEnd()
    Add-Op $drawer '  }, [open, moduleId, fitView, duration]);' '  }, [open, moduleId, tab, fitView, duration]);'
    Add-Op $drawer '  const role = codeModule ? (codeModule.role ?? inferRole(codeModule)) : null;' @'
  const flowTab = tab === "flow";
  const tabs = hasScenarios || flowTab ? [...TABS, { id: "flow" as const, label: "Flujo" }] : TABS;
  const role = codeModule ? (codeModule.role ?? inferRole(codeModule)) : null;
'@.TrimEnd()
    Add-Op $drawer '        {TABS.map(({ id, label }) => (' '        {tabs.map(({ id, label }) => ('
    Add-Op $drawer "        {tab === `"lesson`" ? (`n          <LessonTab module={codeModule} />" @'
        {tab === "flow" ? (
          <FlowTab />
        ) : tab === "lesson" ? (
          <LessonTab module={codeModule} />
'@.TrimEnd()
    Add-Op $drawer "            <p className=`"text-sm text-ink-3`">Selecciona un componente del lienzo</p>`n          )}`n        </div>" @'
            <p className="text-sm text-ink-3">{flowTab ? "Simulación de flujo" : "Selecciona un componente del lienzo"}</p>
          )}
        </div>
'@.TrimEnd()
  }
}

# ── Comprobacion (en memoria) ────────────────────────────────────────────────
$failures = New-Object System.Collections.Generic.List[string]
$results = @{}
foreach ($file in ($ops | Select-Object -ExpandProperty File -Unique)) {
  if (-not (Test-Path $file)) { $failures.Add("No existe el archivo: $file"); continue }
  $original = [System.IO.File]::ReadAllText($file, $utf8)
  $crlf = $original.Contains("`r`n")
  $text = $original
  foreach ($op in ($ops | Where-Object { $_.File -eq $file })) {
    $old = $op.Old
    $new = $op.New
    if ($crlf) {
      $old = $old.Replace("`r`n", "`n").Replace("`n", "`r`n")
      $new = $new.Replace("`r`n", "`n").Replace("`n", "`r`n")
    }
    $count = ([regex]::Matches($text, [regex]::Escape($old))).Count
    if ($count -ne 1) {
      $first = ($op.Old -split "`n")[0]
      $failures.Add("[$count coincidencias] $file :: $first")
      continue
    }
    $text = $text.Replace($old, $new)
  }
  $results[$file] = $text
}

if ($failures.Count -gt 0) {
  Write-Host "Grupo '$Group': NO SE APLICA. Fragmentos que ya no coinciden (aplicalos a mano):" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

if ($Check) {
  Write-Host "Grupo '$Group': todos los fragmentos coinciden ($($ops.Count) cambios en $($results.Count) archivos). No se ha escrito nada." -ForegroundColor Green
  exit 0
}

foreach ($file in $results.Keys) { [System.IO.File]::WriteAllText($file, $results[$file], $utf8) }
Write-Host "Grupo '$Group': aplicado ($($ops.Count) cambios en $($results.Count) archivos)." -ForegroundColor Green
