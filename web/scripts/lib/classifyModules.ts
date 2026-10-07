import type { ModuleRole, ModuleSubsystem } from "@core/graph";
import { inferLayerAndSubsystem } from "../../src/features/canvas/lib/subsystems";
import { AiError, type AiProvider } from "../../src/lib/ai/types";
import {
  MAX_BATCH,
  classifyModulesWithAI,
  digestPythonModule,
  resolveSubsystemName,
  type AiClassification,
  type ModuleDigest,
} from "./aiClassifier";
import { contentHash, type ClassificationCache } from "./classificationCache";

export interface ModuleInput {
  path: string;
  source: string;
  label: string;
  role: ModuleRole;
  blocks: ReadonlyArray<{ kind: string; startLine: number }>;
}

export type ClassificationSource = "heuristic" | "cache" | "ai" | "unresolved";

export interface ModuleClassification {
  layer?: number;
  subsystem?: string;
  source: ClassificationSource;
}

export interface ClassifyOptions {
  /** null = sin IA (sin clave o `--no-ai`): los no resueltos quedan para el fallback por vecinos del lienzo. */
  provider: AiProvider | null;
  cache: ClassificationCache;
  log?: (message: string) => void;
}

export interface ClassifyResult {
  byPath: Map<string, ModuleClassification>;
  /** Subsistemas nuevos propuestos por la IA que no existen en DEFAULT_SUBSYSTEMS. */
  extraSubsystems: ModuleSubsystem[];
}

/**
 * Estrategia híbrida: 1) heurística instantánea; 2) caché por hash de contenido;
 * 3) una llamada al LLM por lote de hasta MAX_BATCH módulos sin resolver.
 * Un fallo de la IA nunca rompe el build: esos módulos quedan "unresolved".
 */
export async function classifyModules(inputs: readonly ModuleInput[], options: ClassifyOptions): Promise<ClassifyResult> {
  const log = options.log ?? (() => undefined);
  const byPath = new Map<string, ModuleClassification>();
  const extraSubsystems: ModuleSubsystem[] = [];
  const fromAi = (classification: AiClassification): Omit<ModuleClassification, "source"> => ({
    layer: classification.layer,
    subsystem: resolveSubsystemName(classification.subsystem, extraSubsystems),
  });

  const pending: Array<{ input: ModuleInput; hash: string; digest: ModuleDigest }> = [];
  for (const input of inputs) {
    const heuristic = inferLayerAndSubsystem(input.path, input.role, input.label);
    if (heuristic) {
      byPath.set(input.path, { ...heuristic, source: "heuristic" });
      continue;
    }
    const hash = contentHash(input.source);
    const cached = options.cache.get(hash);
    if (cached) {
      byPath.set(input.path, { ...fromAi(cached), source: "cache" });
      continue;
    }
    pending.push({ input, hash, digest: digestPythonModule(input.path, input.source, input.blocks) });
  }

  if (pending.length > 0 && !options.provider) {
    log(`${pending.length} módulo(s) sin clasificar y sin proveedor de IA; se resolverán por vecinos en el lienzo.`);
  }

  if (pending.length > 0 && options.provider) {
    const provider = options.provider;
    for (let start = 0; start < pending.length; start += MAX_BATCH) {
      const batch = pending.slice(start, start + MAX_BATCH);
      try {
        const found = await classifyModulesWithAI(batch.map((item) => item.digest), provider);
        for (const item of batch) {
          const classification = found.get(item.input.path);
          if (!classification) continue;
          options.cache.set(item.hash, {
            ...classification,
            path: item.input.path,
            model: `${provider.id}:${provider.model}`,
            classifiedAt: new Date().toISOString(),
          });
          byPath.set(item.input.path, { ...fromAi(classification), source: "ai" });
          log(`IA · ${item.input.path} → capa ${classification.layer} · ${classification.subsystem} (${classification.reasoning})`);
        }
      } catch (error) {
        const detail = error instanceof AiError ? `${error.hint}${error.detail ? ` (${error.detail})` : ""}` : String(error);
        log(`Falló la clasificación IA de ${batch.length} módulo(s): ${detail}`);
      }
    }
    options.cache.save();
  }

  for (const item of pending) {
    if (!byPath.has(item.input.path)) byPath.set(item.input.path, { source: "unresolved" });
  }
  return { byPath, extraSubsystems };
}
