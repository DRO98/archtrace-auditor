import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodeGraph, CodeModule, CodeSubBlock, GroupColor, ModuleGroup, ModuleRole, ModuleSubsystem } from "@core/graph";
import { deriveSubtitle, humanizeLabel, inferRole } from "../src/features/canvas/lib/architecture";
import { DEFAULT_SUBSYSTEMS, STAGE } from "../src/features/canvas/lib/subsystems";
import { createProviderFromEnv } from "../src/lib/ai";
import { ClassificationCache } from "./lib/classificationCache";
import { classifyModules, type ClassificationSource } from "./lib/classifyModules";
import { resolveImports, scanPythonSource } from "./lib/pyScan";

interface SandboxArchitecture {
  label: string;
  role: ModuleRole;
  subtitle: string;
  supportOf?: string;
  /** Columna del flujo: entrada → preproceso → índice → orquestación → generación. */
  layer: number;
  subsystem?: string;
}

const SANDBOX_ARCHITECTURE: Readonly<Record<string, SandboxArchitecture>> = {
  "src/api/routes.py": { label: "API Routes", role: "api", subtitle: "ask_question · ingest_document", layer: STAGE.entry },
  "src/rag/pipeline.py": { label: "RAG Pipeline", role: "pipeline", subtitle: "ingest · retrieve · answer", layer: STAGE.orchestration },
  "src/rag/chunker.py": { label: "Chunker", role: "transform", subtitle: "chunk_text", layer: STAGE.preprocess, subsystem: "rag-core" },
  "src/llm/service.py": { label: "LLM Service", role: "ai-model", subtitle: "complete · stream_tokens", layer: STAGE.generation, subsystem: "inference" },
  "src/db/database.py": { label: "Notes Database", role: "database", subtitle: "load · save · insert", layer: STAGE.index, subsystem: "infra" },
  "src/rag/vector_store.py": {
    label: "Vector Store",
    role: "database",
    subtitle: "upsert · search",
    supportOf: "src/rag/pipeline.py",
    layer: STAGE.index,
    subsystem: "rag-core",
  },
  "src/rag/embeddings.py": {
    label: "Embedder",
    role: "ai-model",
    subtitle: "embed · embed_many",
    supportOf: "src/rag/pipeline.py",
    layer: STAGE.index,
    subsystem: "rag-core",
  },
  "src/llm/prompts.py": {
    label: "Prompts",
    role: "prompt",
    subtitle: "build_prompt",
    supportOf: "src/llm/service.py",
    layer: STAGE.generation,
    subsystem: "inference",
  },
  "src/bootstrap/app.py": { label: "App Bootstrap", role: "app", subtitle: "build_pipeline · main", layer: STAGE.entry },
};

const GROUP_CATALOG: readonly ModuleGroup[] = [
  { id: "api", label: "API Gateway", color: "sky" },
  { id: "rag", label: "RAG Pipeline", color: "violet" },
  { id: "db", label: "Database", color: "emerald" },
  { id: "llm", label: "LLM Service", color: "amber" },
  { id: "bootstrap", label: "App Bootstrap", color: "rose" },
];

const SUBSYSTEM_CATALOG: readonly ModuleSubsystem[] = DEFAULT_SUBSYSTEMS.map(({ id, label, color }) => ({ id, label, color }));

interface BuildOptions {
  sandboxRoot: string;
  useAi: boolean;
  cacheFile: string;
}

function walkPython(directory: string, root: string, files: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkPython(absolute, root, files);
    else if (entry.name.endsWith(".py")) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
}

function groupFor(filePath: string): { id: string; color: GroupColor } {
  const folder = filePath.split("/")[1] ?? "root";
  const known = GROUP_CATALOG.find((group) => group.id === folder);
  return known ?? { id: folder, color: "zinc" };
}

async function buildGraph({ sandboxRoot, useAi, cacheFile }: BuildOptions): Promise<CodeGraph> {
  const files: string[] = [];
  walkPython(path.join(sandboxRoot, "src"), sandboxRoot, files);
  files.sort((left, right) => left.localeCompare(right));
  const known = new Set(files);
  const sources = new Map(files.map((filePath) => [filePath, readFileSync(path.join(sandboxRoot, filePath), "utf8")]));

  const scannedBlocks = new Map(files.map((filePath) => [filePath, scanPythonSource(sources.get(filePath) ?? "")]));
  const modules: CodeModule[] = files.map((filePath) => {
    const subBlocks: CodeSubBlock[] = (scannedBlocks.get(filePath) ?? []).map((block) => {
      const sub: CodeSubBlock = {
        id: `${filePath}::${block.name}`,
        kind: block.kind,
        name: block.name,
        range: { startLine: block.startLine, endLine: block.endLine },
      };
      if (block.parentName) sub.parentId = `${filePath}::${block.parentName}`;
      return sub;
    });
    const fileName = filePath.split("/").pop() ?? filePath;
    const scanned: CodeModule = {
      id: filePath,
      label: fileName,
      filePath,
      groupId: groupFor(filePath).id,
      language: "python",
      subBlocks,
    };
    const override = SANDBOX_ARCHITECTURE[filePath];
    return {
      id: scanned.id,
      label: override?.label ?? humanizeLabel(fileName),
      filePath: scanned.filePath,
      groupId: scanned.groupId,
      language: scanned.language,
      role: override?.role ?? inferRole(scanned),
      subtitle: override?.subtitle ?? deriveSubtitle(scanned),
      ...(override?.supportOf ? { supportOf: override.supportOf } : {}),
      ...(override ? { layer: override.layer } : {}),
      ...(override?.subsystem ? { subsystem: override.subsystem } : {}),
      subBlocks: scanned.subBlocks,
    };
  });

  // Capa/subsistema: overrides a mano > heurística > caché > IA en lote. Se persisten en el JSON.
  const unclassified = modules.filter((item) => item.layer === undefined);
  const classified = await classifyModules(
    unclassified.map((item) => ({
      path: item.filePath,
      source: sources.get(item.filePath) ?? "",
      label: item.label,
      role: item.role ?? inferRole(item),
      blocks: scannedBlocks.get(item.filePath) ?? [],
    })),
    {
      provider: useAi ? createProviderFromEnv() : null,
      cache: ClassificationCache.load(cacheFile),
      log: (message) => console.info(`[classify] ${message}`),
    },
  );
  const tally = new Map<ClassificationSource, number>();
  for (const item of unclassified) {
    const result = classified.byPath.get(item.filePath);
    if (!result) continue;
    tally.set(result.source, (tally.get(result.source) ?? 0) + 1);
    if (result.layer !== undefined) item.layer = result.layer;
    if (result.subsystem !== undefined) item.subsystem = result.subsystem;
  }
  const summary = [...tally].map(([source, count]) => `${count} ${source}`).join(" · ");
  console.info(`[classify] ${modules.length - unclassified.length} por override${summary ? ` · ${summary}` : ""}`);

  const used = new Set(modules.map((item) => item.groupId));
  const groups = [
    ...GROUP_CATALOG.filter((group) => used.has(group.id)),
    ...[...used]
      .filter((id) => !GROUP_CATALOG.some((group) => group.id === id))
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ id, label: id, color: "zinc" as const })),
  ];

  const edges: CodeGraph["edges"] = [];
  const seen = new Set<string>();
  for (const filePath of files) {
    for (const target of resolveImports(sources.get(filePath) ?? "", filePath, known)) {
      if (target === filePath) continue;
      const id = `imports:${filePath}:${target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, source: filePath, target, kind: "imports", label: "imports" });
    }
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));

  const usedSubsystems = new Set(modules.map((item) => item.subsystem));
  const subsystems = [...SUBSYSTEM_CATALOG, ...classified.extraSubsystems].filter((item) => usedSubsystems.has(item.id));

  return { version: 1, projectName: "sandbox", groups, modules, edges, subsystems };
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadEnv(webRoot: string): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(webRoot, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

async function main(): Promise<void> {
  const webRoot = process.cwd();
  loadEnv(webRoot);
  const sandboxRoot = path.resolve(webRoot, argValue("--root") ?? "../sandbox");
  const outName = argValue("--out") ?? "macro_rag_project";
  if (!/^[a-z0-9_-]+$/.test(outName)) throw new Error(`--out inválido: ${outName}`);
  const destination = path.join(webRoot, "public", "graphs");
  mkdirSync(destination, { recursive: true });
  const graph = await buildGraph({
    sandboxRoot,
    useAi: !process.argv.includes("--no-ai"),
    cacheFile: path.join(webRoot, ".cache", "module-layers.json"),
  });
  writeFileSync(path.join(destination, `${outName}.json`), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
