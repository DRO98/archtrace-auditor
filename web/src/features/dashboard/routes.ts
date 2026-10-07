import { PIPELINE_BASE_PATH } from "@/features/canvas/lib/graphName";

/** Rutas de la navegación global del dashboard. */
export const DASHBOARD_ROUTES = {
  pipelines: "/dashboard/pipelines",
  api: "/dashboard/api-keys",
  settings: "/dashboard/settings",
} as const;

export function isPipelineEditorPath(pathname: string): boolean {
  return pathname.startsWith(`${PIPELINE_BASE_PATH}/`);
}
