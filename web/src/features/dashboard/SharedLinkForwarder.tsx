"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PROJECT_GRAPH, pipelineHref } from "@/features/canvas/lib/graphName";
import { sharedDataFromHash } from "@/features/share/lib/shareState";

/**
 * `/`: los enlaces compartidos (`/#data=…`) solo existen en el cliente; se reenvían al editor del mapa.
 * Sin fragmento, se abre la pantalla de inicio (`fallback`).
 */
export function SharedLinkForwarder({ fallback }: { fallback: string }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    router.replace(sharedDataFromHash(hash) ? `${pipelineHref(PROJECT_GRAPH)}${hash}` : fallback);
  }, [router, fallback]);
  return <div className="h-dvh bg-app" aria-busy="true" />;
}
