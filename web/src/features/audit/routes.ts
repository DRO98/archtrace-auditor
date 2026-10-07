/** Rutas de la sección de auditorías. */
export const AUDIT_BASE_PATH = "/dashboard/audit";

const AUDIT_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export function isAuditIdParam(value: string): boolean {
  return AUDIT_ID.test(value);
}

export function auditHref(repoId: string, auditId: string): string {
  return `${AUDIT_BASE_PATH}/${encodeURIComponent(auditId)}?repo=${encodeURIComponent(repoId)}`;
}
