import { redirect } from "next/navigation";
import { isGraphName, pipelineHref } from "@/features/canvas/lib/graphName";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { SharedLinkForwarder } from "@/features/dashboard/SharedLinkForwarder";

/**
 * Entrada: la pantalla de inicio es Auditorías. La landing del tutor sigue en `/welcome`. Atajos heredados:
 * - `/?repo=owner/name` (deep link web-first) → Pipelines, que abre el grafo guardado o lo importa.
 * - `/?license=<clave>` (confirmación del pago) → Ajustes, que valida y activa Pro.
 * - `/?graph=<nombre>` (enlaces antiguos) → el editor de ese grafo.
 * Un enlace compartido (`/#data=…`) no llega al servidor: `SharedLinkForwarder` lo reenvía al editor en el cliente.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { graph, repo, license } = await searchParams;
  if (typeof repo === "string" && repo.trim()) redirect(`${DASHBOARD_ROUTES.pipelines}?repo=${encodeURIComponent(repo.trim())}`);
  if (typeof license === "string" && license.trim()) redirect(`${DASHBOARD_ROUTES.settings}?license=${encodeURIComponent(license.trim())}`);
  if (typeof graph === "string" && isGraphName(graph)) redirect(pipelineHref(graph));
  // El fragmento no llega al servidor: un cliente mínimo reenvía `/#data=…` al editor o abre Auditorías.
  return <SharedLinkForwarder fallback={DASHBOARD_ROUTES.audit} />;
}
