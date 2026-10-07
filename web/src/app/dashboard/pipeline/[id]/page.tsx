import { notFound } from "next/navigation";
import { isGraphName } from "@/features/canvas/lib/graphName";
import { CanvasApp } from "@/features/canvas/CanvasApp";

/** El `[id]` es el nombre del grafo; `CanvasApp` lo lee de la URL para poder cambiar de grafo sin remontar. */
export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isGraphName(decodeURIComponent(id))) notFound();
  return <CanvasApp />;
}
