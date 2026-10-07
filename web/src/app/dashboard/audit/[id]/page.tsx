import { notFound } from "next/navigation";
import { AuditReview } from "@/features/audit/AuditReview";
import { isAuditIdParam } from "@/features/audit/routes";

/** Revisión de una auditoría. `?repo=<id>` identifica el repo vinculado en el auditor local. */
export default async function AuditReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ repo?: string | string[] }>;
}) {
  const { id } = await params;
  const { repo } = await searchParams;
  const auditId = decodeURIComponent(id);
  if (!isAuditIdParam(auditId) || typeof repo !== "string" || !/^[0-9a-f]{16}$/.test(repo)) notFound();
  return <AuditReview repoId={repo} auditId={auditId} />;
}
