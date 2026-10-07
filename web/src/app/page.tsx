import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isGraphName, pipelineHref } from "@/features/canvas/lib/graphName";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { Landing } from "@/features/landing/Landing";

export const metadata: Metadata = {
  title: "ArchTrace — Understand any AI-generated repo in 60 seconds",
  description: "Paste a GitHub repo: architecture map, Architecture Check and scoped prompts for Cursor. Runs in your browser.",
};

/**
 * Entrada pública: landing en inglés con el campo para pegar un repo. Atajos que la saltan:
 * - `/?repo=owner/name` (deep link web-first) → Pipelines, que abre el grafo guardado o lo importa.
 * - `/?license=<clave>` (confirmación del pago) → Ajustes, que valida y activa Pro.
 * - `/?graph=<nombre>` (enlaces antiguos) → el editor de ese grafo.
 * Un enlace compartido (`/#data=…`) no llega al servidor: la landing lo reenvía al editor en el cliente.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { graph, repo, license } = await searchParams;
  if (typeof repo === "string" && repo.trim()) redirect(`${DASHBOARD_ROUTES.pipelines}?repo=${encodeURIComponent(repo.trim())}`);
  if (typeof license === "string" && license.trim()) redirect(`${DASHBOARD_ROUTES.settings}?license=${encodeURIComponent(license.trim())}`);
  if (typeof graph === "string" && isGraphName(graph)) redirect(pipelineHref(graph));
  return <Landing />;
}
