import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CRITICALITIES, type Criticality, type SignalStrength } from "@core/audit";
import defaults from "../../taxonomy.default.json";

export interface TaxonomyCategory {
  id: string;
  prefix: string;
  label: string;
  description: string;
  defaultCriticality: Criticality;
  keywords: string[];
  /** Sin señales de riesgo se resuelve como BAJA sin LLM (tests, estilos, docs). */
  trivial?: boolean;
}

export interface DetectorSpec {
  id: string;
  category: string;
  target: "line" | "path";
  strength: SignalStrength;
  floor: Criticality;
  pattern: string;
  /** Por defecto `i`. `""` para distinguir mayúsculas (palabras clave SQL). */
  flags?: string;
  /** Solo aplica a rutas que casen con esta expresión. */
  paths?: string;
}

export interface Detector extends Omit<DetectorSpec, "pattern" | "paths"> {
  pattern: RegExp;
  paths?: RegExp;
}

export interface Taxonomy {
  version: string;
  categories: TaxonomyCategory[];
  detectors: Detector[];
  byId: ReadonlyMap<string, TaxonomyCategory>;
}

/** `.archtrace/taxonomy.json` del repo: añade o sustituye categorías y detectores por id, o desactiva detectores. */
export interface TaxonomyOverride {
  version?: string;
  categories?: TaxonomyCategory[];
  detectors?: DetectorSpec[];
  disableDetectors?: string[];
}

export const UNKNOWN_CATEGORY = "unknown";
export const UNKNOWN_PREFIX = "UNK";

interface RawTaxonomy {
  version: string;
  categories: TaxonomyCategory[];
  detectors: DetectorSpec[];
}

export function loadTaxonomy(repoRoot: string | null, warnings: string[] = []): Taxonomy {
  const base = defaults as RawTaxonomy;
  let override: TaxonomyOverride | null = null;
  if (repoRoot) {
    const file = path.join(repoRoot, ".archtrace", "taxonomy.json");
    if (existsSync(file)) {
      try {
        override = JSON.parse(readFileSync(file, "utf8")) as TaxonomyOverride;
      } catch (error) {
        warnings.push(`.archtrace/taxonomy.json no es JSON válido: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return buildTaxonomy(base, override, warnings);
}

export function buildTaxonomy(base: RawTaxonomy, override: TaxonomyOverride | null, warnings: string[] = []): Taxonomy {
  const categories = new Map(base.categories.map((category) => [category.id, category]));
  for (const category of override?.categories ?? []) {
    if (!isCategory(category)) {
      warnings.push(`Categoría de taxonomía ignorada: ${JSON.stringify(category).slice(0, 120)}`);
      continue;
    }
    categories.set(category.id, { ...categories.get(category.id), ...category });
  }
  const specs = new Map(base.detectors.map((detector) => [detector.id, detector]));
  for (const detector of override?.detectors ?? []) specs.set(detector.id, detector);
  for (const id of override?.disableDetectors ?? []) specs.delete(id);

  const detectors: Detector[] = [];
  for (const spec of specs.values()) {
    if (!categories.has(spec.category) || !CRITICALITIES.includes(spec.floor)) {
      warnings.push(`Detector ${spec.id}: categoría o suelo desconocidos.`);
      continue;
    }
    try {
      const { paths, pattern, ...rest } = spec;
      detectors.push({
        ...rest,
        pattern: new RegExp(pattern, spec.flags ?? "i"),
        ...(paths ? { paths: new RegExp(paths, "i") } : {}),
      });
    } catch (error) {
      warnings.push(`Detector ${spec.id}: expresión inválida (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  const list = [...categories.values()];
  const version = override?.version ? `${base.version}+${override.version}` : override ? `${base.version}+repo` : base.version;
  return { version, categories: list, detectors, byId: new Map(list.map((category) => [category.id, category])) };
}

function isCategory(value: unknown): value is TaxonomyCategory {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    /^[a-z][a-z0-9_]{1,40}$/.test(record.id) &&
    typeof record.prefix === "string" &&
    /^[A-Z][A-Z0-9]{1,9}$/.test(record.prefix) &&
    typeof record.label === "string" &&
    CRITICALITIES.includes(record.defaultCriticality as Criticality) &&
    Array.isArray(record.keywords)
  );
}

export function categoryPrefix(taxonomy: Taxonomy, category: string): string {
  return taxonomy.byId.get(category)?.prefix ?? UNKNOWN_PREFIX;
}

export function categoryLabel(taxonomy: Taxonomy, category: string): string {
  return taxonomy.byId.get(category)?.label ?? "Desconocida";
}
