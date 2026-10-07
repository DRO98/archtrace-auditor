import {
  CRITICALITIES,
  CRITICALITY_LABEL,
  type AuditRun,
  type FieldOrigin,
  type Finding,
  type ReviewStatus,
} from "@core/audit";

export const AUDIT_ID_MARKER = "archtrace-audit-id";

const REVIEW_LABEL: Readonly<Record<ReviewStatus, string>> = {
  pending: "⏳ pendiente",
  reviewed: "👀 revisado",
  accepted: "✅ aceptado",
  rejected: "❌ rechazado",
  false_positive: "🚫 falso positivo",
};

const ORIGIN_LABEL: Readonly<Record<FieldOrigin, string>> = { rule: "regla", llm: "LLM", both: "regla + LLM", none: "—" };

const MODE_LABEL: Readonly<Record<AuditRun["mode"], string>> = {
  range: "rango",
  commit: "commit",
  branch: "rama (desde merge-base)",
  worktree: "árbol de trabajo",
};

/** Código en línea seguro aunque el texto tenga acentos graves. */
function code(text: string): string {
  const clean = text.replace(/\r?\n/g, " ");
  if (!clean.includes("`")) return `\`${clean}\``;
  return `\`\` ${clean} \`\``;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function short(sha: string): string {
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha.slice(0, 8) : sha;
}

function lineRange(finding: Pick<Finding, "lines">): string {
  const { startLine, endLine } = finding.lines;
  return startLine === endLine ? `L${startLine}` : `L${startLine}–L${endLine}`;
}

/**
 * `Auditoria.md`: vista legible de la auditoría vigente, regenerada siempre desde el JSON sidecar
 * (`.archtrace/audits/<id>.json`), que es la fuente de verdad. Los enlaces son relativos a la raíz del repo.
 */
export function renderAuditMarkdown(run: AuditRun): string {
  const labels = new Map(run.categories.map((category) => [category.id, category.label]));
  const label = (id: string) => labels.get(id) ?? "Desconocida";
  const reviewed = run.findings.filter((finding) => finding.review.status !== "pending").length;
  const out: string[] = [];

  out.push(`<!-- ${AUDIT_ID_MARKER}: ${run.id} -->`);
  out.push(`<!-- Generado por ArchTrace Auditor. No editar a mano: el estado de revisión vive en .archtrace/audits/${run.id}.json -->`);
  out.push("");
  out.push(`# Auditoría de cambios — ${run.repo.name}`);
  out.push("");
  out.push("| Campo | Valor |");
  out.push("| --- | --- |");
  out.push(`| Auditoría | ${code(run.id)} |`);
  out.push(`| Fecha | ${run.createdAt} |`);
  out.push(`| Modo | ${MODE_LABEL[run.mode]} |`);
  out.push(`| Base → head | ${code(run.base)} (${code(short(run.baseSha))}) → ${code(run.head)} (${code(short(run.headSha))}) |`);
  if (run.taskId) out.push(`| Tarea / requisito | ${cell(run.taskId)} |`);
  if (run.planPath) out.push(`| Plan del agente | [${cell(run.planPath)}](${encodeURI(run.planPath)}) |`);
  out.push(`| Taxonomía | ${code(run.taxonomyVersion)} |`);
  out.push(`| LLM | ${run.llm ? `${run.llm.provider} · ${code(run.llm.model)} · prompt ${code(run.llm.promptVersion)}` : "sin LLM (solo reglas deterministas)"} |`);
  out.push("");

  out.push("## Resumen");
  out.push("");
  out.push(`| ${CRITICALITIES.map((criticality) => CRITICALITY_LABEL[criticality]).join(" | ")} | Total |`);
  out.push(`| ${CRITICALITIES.map(() => "---:").join(" | ")} | ---: |`);
  out.push(`| ${CRITICALITIES.map((criticality) => run.summary[criticality]).join(" | ")} | ${run.findings.length} |`);
  out.push("");
  out.push(`Revisión: ${reviewed}/${run.findings.length} hallazgos con estado distinto de pendiente.`);
  out.push("");

  const metrics = run.metrics;
  const share = metrics.linesTotal > 0 ? Math.round((metrics.linesPrioritized / metrics.linesTotal) * 100) : 0;
  out.push("## Métricas");
  out.push("");
  out.push(`- Archivos cambiados: ${metrics.filesChanged} · unidades: ${metrics.unitsTotal} (resueltas sin LLM: ${metrics.unitsWithoutLlm})`);
  out.push(`- Líneas cambiadas: ${metrics.linesTotal} · priorizadas: ${metrics.linesPrioritized} (${share} %)`);
  out.push(
    `- LLM: ${metrics.llmCalls} llamadas, ${metrics.cacheHits} desde caché, tokens entrada/salida ${metrics.tokensIn}/${metrics.tokensOut}${metrics.tokensEstimated ? " (estimados)" : ""}`,
  );
  if (metrics.contextTokensByLevel.length > 0) {
    out.push(`- Tokens de contexto por nivel: ${metrics.contextTokensByLevel.map((tokens, level) => `L${level}=${tokens}`).join(", ")}`);
  }
  out.push(
    `- Índice: blobs parseados ${metrics.index.blobsParsed}, reutilizados ${metrics.index.blobsReused}; docs parseados ${metrics.index.docsParsed}, reutilizados ${metrics.index.docsReused}`,
  );
  const retrieval = metrics.retrieval ?? { mode: "bm25", embedded: 0, reused: 0 };
  out.push(
    `- Recuperación de reglas: ${retrieval.mode === "hybrid" ? `híbrida BM25 + vectores (embebidos ahora ${retrieval.embedded}, reutilizados ${retrieval.reused})` : "léxica (BM25)"}`,
  );
  out.push(`- Tiempos: ${Object.entries(metrics.stageMs).map(([stage, ms]) => `${stage} ${ms} ms`).join(", ") || "—"}`);
  out.push("");

  if (run.warnings.length > 0) {
    out.push("## Avisos");
    out.push("");
    for (const warning of run.warnings) out.push(`- ${warning}`);
    out.push("");
  }

  out.push("## Hallazgos");
  out.push("");
  if (run.findings.length === 0) out.push("Sin cambios que auditar.");
  for (const finding of run.findings) {
    const where = `${code(finding.file)}${finding.symbol ? ` · ${code(finding.symbol)}` : ""} (${lineRange(finding)}${finding.side === "base" ? ", versión base" : ""})`;
    out.push(`### ${finding.id} · ${CRITICALITY_LABEL[finding.criticality]} · ${where}`);
    out.push("");
    out.push(
      `- **Categoría:** ${label(finding.category)} (${code(finding.category)}) · **Confianza:** ${finding.confidence.toFixed(2)} · **Revisión:** ${REVIEW_LABEL[finding.review.status]}${finding.review.updatedAt ? ` (${finding.review.updatedAt})` : ""}`,
    );
    if (finding.humanReviewRequired) out.push("- **Requiere revisión humana:** sí");
    out.push(`- **Motivo:** ${finding.reason}`);
    const context = finding.contextLevel < 0 ? "sin LLM" : `nivel L${finding.contextLevel}`;
    out.push(
      `- **Origen:** categoría=${ORIGIN_LABEL[finding.origin.category]}, criticidad=${ORIGIN_LABEL[finding.origin.criticality]}, motivo=${ORIGIN_LABEL[finding.origin.reason]} · contexto: ${context}`,
    );
    if (finding.semantic) {
      const usage = finding.semantic.usage;
      const dropped = finding.semantic.dropped;
      const notes = [
        usage ? `tokens ${usage.promptTokens}/${usage.completionTokens}` : null,
        finding.semantic.cached ? "caché" : null,
        finding.semantic.escalations > 0 ? `${finding.semantic.escalations} escalados` : null,
        dropped.evidence > 0 ? `${dropped.evidence} evidencias descartadas` : null,
        dropped.ruleRefs > 0 ? `${dropped.ruleRefs} reglas inexistentes descartadas` : null,
        dropped.invalidCategory ? "categoría fuera de taxonomía" : null,
      ].filter(Boolean);
      if (notes.length > 0) out.push(`- **LLM:** ${notes.join(" · ")}`);
    }
    const signals = finding.signals.slice(0, 8);
    if (signals.length > 0) {
      out.push(
        `- **Señales:** ${signals
          .map((signal) => `${code(signal.token)} (${signal.detector}${signal.line > 0 ? `, L${signal.line}${signal.side === "base" ? " base" : ""}` : ", ruta"}, ${signal.strength === "strong" ? "fuerte" : "débil"})`)
          .join(", ")}${finding.signals.length > signals.length ? ` y ${finding.signals.length - signals.length} más` : ""}`,
      );
    }
    if (finding.evidence.length > 0) {
      out.push("- **Evidencias:**");
      for (const item of finding.evidence) {
        out.push(`  - L${item.line} (${item.side === "base" ? "base" : "head"}, ${item.source === "llm" ? "LLM" : "regla"}): ${code(item.text)}`);
      }
    }
    if (finding.rules.length > 0) {
      out.push("- **Reglas:**");
      for (const rule of finding.rules) {
        const target = `${encodeURI(rule.file)}#L${rule.lines.startLine}`;
        out.push(
          `  - [${rule.sectionId}](${target}) — ${rule.headingPath.join(" › ")} (L${rule.lines.startLine}–L${rule.lines.endLine})${rule.critical ? " · crítica" : ""}: «${rule.excerpt}»`,
        );
      }
    }
    if (finding.relatedTests.length > 0) out.push(`- **Tests relacionados en el diff:** ${finding.relatedTests.map(code).join(", ")}`);
    if (finding.review.note) out.push(`- **Nota de revisión:** ${finding.review.note.replace(/\r?\n/g, " ")}`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
