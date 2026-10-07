"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { GRAPH_CHANGE_EVENT, graphNameFromPath } from "./graphName";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  window.addEventListener(GRAPH_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(GRAPH_CHANGE_EVENT, onChange);
  };
}

const readHash = (): string => window.location.hash;
const serverHash = (): null => null;

/**
 * Grafo pedido en la URL; `null` en el servidor. La ruta sale de `usePathname` (que Next.js mantiene al día
 * con `<Link>` y con `pushState`); el `#data=` de los enlaces compartidos, de `window.location`.
 */
export function useGraphName(): string | null {
  const pathname = usePathname();
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  return hash === null ? null : graphNameFromPath(pathname, hash);
}
