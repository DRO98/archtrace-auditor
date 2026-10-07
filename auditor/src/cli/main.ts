import path from "node:path";
import { AUDIT_MODES, AUDITOR_DEFAULT_PORT, CRITICALITIES, CRITICALITY_LABEL, CRITICALITY_RANK, type AuditMode, type Criticality } from "@core/audit";
import { AI_PROVIDER_IDS, isProviderId } from "@llm/catalog";
import { createProvider, createProviderFromEnv } from "@llm/index";
import type { AiProvider } from "@llm/types";
import { loadAuditorEnv } from "../env";
import { repoToplevel } from "../git/changes";
import { runAudit } from "../pipeline";
import { isReviewStatus, listAudits, updateReview } from "../report/store";
import { createAuditorServer, DEFAULT_ALLOWED_ORIGINS, listen } from "../server/server";

const HELP = `archtrace-audit — auditor de cambios hechos por agentes IA

Uso:
  archtrace-audit [run] [opciones]          Audita y escribe Auditoria.md + .archtrace/audits/<id>.json
  archtrace-audit serve [--port 8090]       API HTTP local para la UI (127.0.0.1)
  archtrace-audit list [--repo <dir>]       Historial de auditorías del repo
  archtrace-audit review <auditId> <findingId> <estado> [--note <texto>]
                                            Estados: pending, reviewed, accepted, rejected, false_positive

Opciones de run:
  --repo <dir>        Carpeta del repo (por defecto, el directorio actual)
  --mode <modo>       commit (defecto) | range | branch | worktree
  --base <ref>        Base (range/branch; worktree: por defecto HEAD)
  --head <ref>        Cabeza (range; commit: por defecto HEAD)
  --task <id>         Tarea o requisito que implementaba el agente
  --plan <ruta>       Plan del agente (se enlaza en el informe)
  --llm <fuente>      off (defecto) | env | ${AI_PROVIDER_IDS.join(" | ")}
  --model <nombre>    Modelo para --llm <proveedor>
  --escalations <n>   Escalados de contexto como máximo (0–2, defecto 2)
  --fail-on <nivel>   Sale con código 2 si hay hallazgos >= nivel (critical | high | medium)
  --dry-run           No escribe Auditoria.md ni el JSON
  --json              Imprime el AuditRun completo en JSON

Opciones de serve:
  --host <host>       127.0.0.1 por defecto (no expongas el auditor fuera de loopback)
  --port <n>          ${AUDITOR_DEFAULT_PORT} por defecto
  --origin <url>      Origin permitido (repetible). Por defecto: ${DEFAULT_ALLOWED_ORIGINS.join(", ")}

Las claves BYOK se leen del entorno o de auditor/.env (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY…)
u Ollama local (OLLAMA_BASE_URL); nunca se guardan. En serve, la UI puede enviar la clave de su bóveda.`;

interface Parsed {
  positional: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN_FLAGS = new Set(["dry-run", "json", "help"]);

function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "-h") {
      flags.set("help", ["true"]);
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const value = BOOLEAN_FLAGS.has(name) ? "true" : (inline ?? argv[++index]);
    if (value === undefined) throw new Error(`Falta el valor de --${name}.`);
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positional, flags };
}

function flag(parsed: Parsed, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function providerFrom(parsed: Parsed): AiProvider | null {
  const source = flag(parsed, "llm") ?? "off";
  if (source === "off") return null;
  if (source === "env") {
    const provider = createProviderFromEnv();
    if (!provider) throw new Error("--llm env: no hay ninguna clave de proveedor en el entorno.");
    return provider;
  }
  if (!isProviderId(source)) throw new Error(`--llm no válido: ${source}`);
  const provider = createProvider({ provider: source, model: flag(parsed, "model") });
  if (!provider) throw new Error(`--llm ${source}: falta la clave en el entorno (o la URL local no es válida).`);
  return provider;
}

async function commandRun(parsed: Parsed): Promise<number> {
  const mode = (flag(parsed, "mode") ?? "commit") as AuditMode;
  if (!AUDIT_MODES.includes(mode)) throw new Error(`--mode no válido: ${mode}`);
  const failOn = flag(parsed, "fail-on") as Criticality | undefined;
  if (failOn && !CRITICALITIES.includes(failOn)) throw new Error(`--fail-on no válido: ${failOn}`);
  const escalations = flag(parsed, "escalations");
  const provider = providerFrom(parsed);
  const { run } = await runAudit({
    repo: path.resolve(flag(parsed, "repo") ?? process.cwd()),
    mode,
    base: flag(parsed, "base"),
    head: flag(parsed, "head"),
    taskId: flag(parsed, "task"),
    planPath: flag(parsed, "plan"),
    provider,
    ...(escalations !== undefined ? { maxEscalations: Math.max(0, Math.min(2, Number(escalations) || 0)) } : {}),
    write: flag(parsed, "dry-run") !== "true",
  });

  if (flag(parsed, "json") === "true") {
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  } else {
    const summary = CRITICALITIES.map((criticality) => `${CRITICALITY_LABEL[criticality]} ${run.summary[criticality]}`).join(" · ");
    console.log(`Auditoría ${run.id} — ${run.repo.name} (${run.mode}: ${run.base} → ${run.head})`);
    console.log(summary);
    for (const finding of run.findings) {
      if (finding.criticality === "low") continue;
      console.log(`  ${finding.id.padEnd(10)} ${CRITICALITY_LABEL[finding.criticality].padEnd(11)} ${finding.file}${finding.symbol ? ` · ${finding.symbol}` : ""} (L${finding.lines.startLine})`);
    }
    const { llmCalls, cacheHits, tokensIn, tokensOut } = run.metrics;
    console.log(`LLM: ${run.llm ? `${run.llm.provider}/${run.llm.model}, ${llmCalls} llamadas, ${cacheHits} caché, ${tokensIn}/${tokensOut} tokens` : "desactivado (solo reglas)"}`);
    for (const warning of run.warnings) console.warn(`Aviso: ${warning}`);
    if (flag(parsed, "dry-run") !== "true") console.log(`Escrito ${path.join(run.repo.root, "Auditoria.md")}`);
  }

  if (failOn) {
    const blocking = run.findings.filter((finding) => finding.criticality !== "unknown" && CRITICALITY_RANK[finding.criticality] >= CRITICALITY_RANK[failOn]);
    if (blocking.length > 0) return 2;
  }
  return 0;
}

async function commandServe(parsed: Parsed): Promise<number> {
  const host = flag(parsed, "host") ?? "127.0.0.1";
  const port = Number(flag(parsed, "port") ?? AUDITOR_DEFAULT_PORT);
  const origins = parsed.flags.get("origin") ?? process.env.ARCHTRACE_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
  const server = createAuditorServer({ allowedOrigins: origins?.length ? origins : DEFAULT_ALLOWED_ORIGINS, log: (message) => console.log(message) });
  const address = await listen(server, { host, port });
  console.log(`ArchTrace Auditor escuchando en http://${address.host}:${address.port}`);
  console.log(`Origins permitidos: ${(origins?.length ? origins : DEFAULT_ALLOWED_ORIGINS).join(", ")}`);
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function commandList(parsed: Parsed): Promise<number> {
  const root = await repoToplevel(path.resolve(flag(parsed, "repo") ?? process.cwd()));
  for (const item of listAudits(root)) {
    const summary = CRITICALITIES.map((criticality) => `${criticality[0]!.toUpperCase()}${item.summary[criticality]}`).join(" ");
    console.log(`${item.id}  ${item.mode.padEnd(8)} ${item.base} → ${item.head}  ${summary}  revisados ${item.reviewed}/${item.total}${item.taskId ? `  [${item.taskId}]` : ""}`);
  }
  return 0;
}

async function commandReview(parsed: Parsed): Promise<number> {
  const [auditId, findingId, status] = parsed.positional.slice(1);
  if (!auditId || !findingId || !isReviewStatus(status)) throw new Error("Uso: archtrace-audit review <auditId> <findingId> <estado> [--note <texto>]");
  const root = await repoToplevel(path.resolve(flag(parsed, "repo") ?? process.cwd()));
  const finding = updateReview(root, auditId, findingId, { status, note: flag(parsed, "note") });
  console.log(`${finding.id}: ${finding.review.status}`);
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (flag(parsed, "help") === "true") {
    console.log(HELP);
    return 0;
  }
  const command = parsed.positional[0] ?? "run";
  switch (command) {
    case "run":
      return commandRun(parsed);
    case "serve":
      return commandServe(parsed);
    case "list":
      return commandList(parsed);
    case "review":
      return commandReview(parsed);
    default:
      console.error(`Comando desconocido: ${command}\n\n${HELP}`);
      return 1;
  }
}

loadAuditorEnv();

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
