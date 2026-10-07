import { PipelinesView } from "@/features/dashboard/pipelines/PipelinesView";

/** `?repo=owner/name` abre ese repo de GitHub: el grafo guardado si ya existe, o su importación. */
export default async function PipelinesPage({ searchParams }: { searchParams: Promise<{ repo?: string | string[] }> }) {
  const { repo } = await searchParams;
  return <PipelinesView initialRepo={typeof repo === "string" && repo.trim() ? repo.trim() : undefined} />;
}
