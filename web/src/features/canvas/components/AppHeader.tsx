"use client";

import { Code2, FileArchive, FileDown, FileText, Image as ImageIcon, Workflow } from "lucide-react";
import { useReactFlow, type ReactFlowInstance } from "@xyflow/react";
import { PlaygroundButton } from "@/features/playground/components/PlaygroundButton";
import { SimulateButton } from "@/features/simulation/components/SimulateButton";
import { MapLevelSwitch } from "./MapLevelSwitch";
import { PresentationButton, ShareStateButton } from "@/features/share/components/ShareButtons";
import { useLessonStore } from "@/features/lesson/store";
import { useSimStore } from "@/features/simulation/store";
import { applyCanvasEdits } from "../edit/components";
import { useCanvasEdits } from "../edit/store";
import { useCanvasStore } from "../store";
import type { AppFlowNode } from "../lib/flow";
import { ARCHITECTURE_DOC_FILENAME } from "../lib/mermaidExporter";
import { exportDocsZip, exportViewport, projectSlug, type ExportFormat } from "./ExportDocsModal";
import { HeaderMenu, type HeaderMenuItem } from "./HeaderMenu";

/** La imagen no necesita modal: se captura el plano general del lienzo y se descarga en el acto. */
function downloadImage(kind: "png" | "svg", projectName: string, flow: ReactFlowInstance<AppFlowNode>): void {
  void exportViewport(kind, `${projectSlug(projectName)}.${kind}`, flow).catch((error: unknown) => {
    console.error("[teacher] exportar imagen", error);
    window.alert(`No se pudo exportar el ${kind.toUpperCase()}.`);
  });
}

/** Zip con ARCHITECTURE.md, Mermaid, PNG, SVG y escenarios, a partir del lienzo montado. */
function downloadZip(flow: ReactFlowInstance<AppFlowNode>): void {
  const storeGraph = useCanvasStore.getState().graph;
  if (!storeGraph) return;
  const { components, notes } = useCanvasEdits.getState();
  const graph = applyCanvasEdits(storeGraph, components);
  const { sessions, session } = useLessonStore.getState();
  const { scenarios } = useSimStore.getState();
  void exportDocsZip({ graph, nodes: flow.getNodes(), edges: flow.getEdges(), sessions, session, scenarios, notes }, flow)
    .then(({ missing }) => {
      if (missing.length > 0) window.alert(`Zip descargado sin ${missing.join(" ni ")}: no se pudo capturar la imagen.`);
    })
    .catch((error: unknown) => {
      console.error("[teacher] exportar zip", error);
      window.alert("No se pudo generar el paquete Zip.");
    });
}

/**
 * Cabecera mínima: Simular · Probar en vivo · Presentación · Compartir · Exportar. El nombre del proyecto
 * y la marca viven en la navegación global; Historial, en la barra de herramientas del lienzo.
 */
export function AppHeader({
  projectName,
  onExport,
  onExportCode,
}: {
  projectName: string;
  onExport: (format: ExportFormat) => void;
  onExportCode: () => void;
}) {
  const view = useCanvasStore((s) => s.view);
  const flow = useReactFlow<AppFlowNode>();
  const onCanvas = view === "architecture";

  const items: HeaderMenuItem[] = [
    {
      id: "markdown",
      label: "Exportar Markdown",
      description: `${ARCHITECTURE_DOC_FILENAME}: Mermaid, componentes, rutas de API y dependencias`,
      icon: <FileText className="size-4" aria-hidden />,
      onSelect: () => onExport("markdown"),
    },
    {
      id: "mermaid",
      label: "Exportar Código Mermaid",
      description: "graph TD listo para GitHub o Notion",
      icon: <Workflow className="size-4" aria-hidden />,
      onSelect: () => onExport("mermaid"),
    },
  ];
  // Imagen y código fuente leen el lienzo montado: no están disponibles desde el historial.
  if (onCanvas) {
    items.push(
      {
        id: "png",
        label: "Exportar Imagen PNG",
        description: "Plano general de toda la arquitectura, a doble resolución",
        icon: <ImageIcon className="size-4" aria-hidden />,
        onSelect: () => downloadImage("png", projectName, flow),
      },
      {
        id: "svg",
        label: "Exportar Imagen SVG",
        description: "Plano general de toda la arquitectura, vectorial",
        icon: <ImageIcon className="size-4" aria-hidden />,
        onSelect: () => downloadImage("svg", projectName, flow),
      },
      {
        id: "zip",
        label: "Exportar paquete Zip",
        description: `${ARCHITECTURE_DOC_FILENAME} + Mermaid + PNG + SVG + escenarios, en un solo archivo`,
        icon: <FileArchive className="size-4" aria-hidden />,
        onSelect: () => downloadZip(flow),
      },
      {
        id: "code",
        label: "Exportar código",
        description: "Plantillas: API HTTP (Express, FastAPI, Spring), eventos (Kafka, Flink) o pipeline RAG",
        icon: <Code2 className="size-4" aria-hidden />,
        onSelect: onExportCode,
      },
    );
  }

  return (
    <header className="relative z-20 flex shrink-0 items-center justify-end gap-2 overflow-x-auto border-b border-line bg-white px-4 py-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {onCanvas ? <MapLevelSwitch className="mr-auto" /> : null}
      {onCanvas ? (
        <div role="group" aria-label="Ejecutar" className="flex shrink-0 items-center gap-1.5">
          <SimulateButton />
          <PlaygroundButton />
        </div>
      ) : null}
      {onCanvas ? (
        <div role="group" aria-label="Compartir" className="flex shrink-0 items-center gap-1.5">
          <PresentationButton />
          <ShareStateButton />
        </div>
      ) : null}
      <HeaderMenu
        label="Exportar"
        icon={<FileDown className="size-4" aria-hidden />}
        title="Exportar la arquitectura: documentación, imagen o código"
        heading="Exportar"
        align="right"
        items={items}
      />
    </header>
  );
}
