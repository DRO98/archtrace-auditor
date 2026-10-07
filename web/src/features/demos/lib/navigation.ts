import { SHARED_GRAPH_PREFIX, graphNameFromLocation, navigateToGraph } from "@/features/canvas/lib/graphName";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { demoByGraph } from "../index";

const RETURN_KEY = "teacher:demo-return-graph";

/** Abre una demo recordando el proyecto desde el que se entró, para "Salir de la demo". */
export function openDemo(graphName: string): void {
  const current = graphNameFromLocation();
  // Un enlace compartido vive en el `#data=` que la navegación borra: no se puede volver a él por nombre.
  if (!demoByGraph(current) && !current.startsWith(SHARED_GRAPH_PREFIX)) {
    try {
      window.sessionStorage.setItem(RETURN_KEY, current);
    } catch {
      // Sin sessionStorage (modo privado estricto): se volverá al grafo por defecto.
    }
  }
  navigateToGraph(graphName);
}

/** Vuelve al proyecto desde el que se abrió la primera demo; si no hay, al hub de Pipelines. */
export function exitDemo(): void {
  let target: string | null = null;
  try {
    const saved = window.sessionStorage.getItem(RETURN_KEY);
    if (saved && /^[a-z0-9_-]+$/.test(saved) && !demoByGraph(saved)) target = saved;
  } catch {
    // Sin sessionStorage: al hub.
  }
  if (target) navigateToGraph(target);
  else window.location.assign(DASHBOARD_ROUTES.pipelines);
}
