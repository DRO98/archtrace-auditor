/**
 * Prioriza qué archivos fuente entran en el análisis cuando hay más que el tope (`MAX_FILES`).
 * Puro y sin dependencias: lo comparten la web (GitHub y carpeta local) y la extensión (scan).
 *
 * Orden alfabético + corte dejaba fuera los paquetes que empiezan por letras tardías en monorepos.
 * Aquí se puntúa cada ruta por señales (entrypoints, carpetas de código vs. ruido) y se reparte
 * el cupo entre paquetes: cada archivo extra del mismo paquete rinde menos que el primero del siguiente.
 */

export interface RankCandidate {
  path: string;
  /** Bytes, si se conocen antes de leer el archivo. */
  size?: number;
}

/** Nombres (sin extensión) que suelen ser puerta de entrada de una app, servicio o paquete. */
const STRONG_ENTRY = new Set(["main", "app", "server", "cli", "__main__", "manage", "wsgi", "asgi", "bootstrap"]);
const ENTRY = new Set(["index", "route", "routes", "router", "api", "handler", "handlers", "urls", "page", "layout", "mod", "lib"]);
/** Carpetas donde vive el código de verdad. */
const CODE_DIRS = new Set(["src", "app", "lib", "server", "api", "cmd", "core", "pkg", "internal"]);
/** Carpetas contenedoras de un monorepo: el paquete es `<contenedor>/<nombre>`. */
const MONOREPO_DIRS = new Set(["packages", "apps", "libs", "services", "modules", "plugins", "crates"]);
/** Ruido: código generado, vendorizado, migraciones, dobles de test, ejemplos. */
const NOISE_DIRS = new Set([
  "vendor",
  "third_party",
  "third-party",
  "generated",
  "__generated__",
  "gen",
  "migrations",
  "__mocks__",
  "mocks",
  "fixtures",
  "__fixtures__",
  "stubs",
]);
/** Periferia: útil, pero no explica la arquitectura. */
const PERIPHERAL_DIRS = new Set(["examples", "example", "samples", "docs", "benchmarks", "bench", "e2e", "test", "tests", "__tests__", "stories", "scripts"]);
const NOISE_FILE = /(\.generated\.|\.gen\.|_pb2(_grpc)?\.py$|\.pb\.|\.d\.ts$|\.min\.js$|\.stories\.|\.test\.|\.spec\.|^conftest\.py$|^test_)/;
const CONFIG_FILE = /\.config\.(c|m)?[jt]s$/;

const DEEP_FROM = 4;

function stemOf(fileName: string): string {
  const dot = fileName.indexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();
}

/** Puntuación de una ruta: más alto = más probable que explique la arquitectura. */
export function sourceScore(path: string, size?: number): number {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";
  const dirs = segments.slice(0, -1).map((segment) => segment.toLowerCase());
  const stem = stemOf(fileName);
  let score = 0;

  if (STRONG_ENTRY.has(stem)) score += 6;
  else if (ENTRY.has(stem)) score += 4;

  if (dirs.some((dir) => CODE_DIRS.has(dir))) score += 2;
  if (dirs.some((dir) => NOISE_DIRS.has(dir))) score -= 8;
  else if (dirs.some((dir) => PERIPHERAL_DIRS.has(dir))) score -= 4;

  if (NOISE_FILE.test(fileName.toLowerCase())) score -= 6;
  else if (CONFIG_FILE.test(fileName.toLowerCase())) score -= 2;

  if (segments.length > DEEP_FROM) score -= Math.min(3, (segments.length - DEEP_FROM) * 0.5);
  if (size !== undefined) {
    if (size > 200 * 1024) score -= 3;
    else if (size > 100 * 1024) score -= 2;
  }
  return score;
}

/** Paquete al que pertenece la ruta: `packages/x`, `apps/y`, la carpeta de primer nivel o la raíz. */
export function packageOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  if (first && MONOREPO_DIRS.has(first) && segments.length >= 3) return `${segments[0]}/${segments[1]}`;
  return segments.length >= 2 ? (segments[0] ?? "") : "";
}

/**
 * Candidatos de mejor a peor. Dentro de cada paquete, el n-ésimo archivo pierde `log2(n + 1)` puntos:
 * los entrypoints de todos los paquetes van antes que el relleno de uno solo. Empates → orden alfabético.
 */
export function rankSources<T extends RankCandidate>(items: readonly T[]): T[] {
  const byPackage = new Map<string, Array<{ item: T; score: number }>>();
  for (const item of items) {
    const key = packageOf(item.path);
    const bucket = byPackage.get(key) ?? [];
    bucket.push({ item, score: sourceScore(item.path, item.size) });
    byPackage.set(key, bucket);
  }
  const adjusted: Array<{ item: T; score: number }> = [];
  for (const bucket of byPackage.values()) {
    bucket.sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path));
    bucket.forEach((entry, index) => adjusted.push({ item: entry.item, score: entry.score - Math.log2(index + 1) }));
  }
  adjusted.sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path));
  return adjusted.map((entry) => entry.item);
}

/** Fracción del tope que se reparte a partes iguales entre paquetes antes de ordenar el resto por puntuación. */
const PACKAGE_QUOTA_SHARE = 0.4;
/** Por debajo de esta puntuación (ruido, tests, ejemplos) un archivo no consume cupo reservado. */
const QUOTA_MIN_SCORE = -3;

/**
 * Los `limit` mejores, devueltos en orden alfabético para que el grafo resultante sea estable.
 * Cupo mínimo por paquete: en un monorepo multiparte (`parte1_*`, `apps/*`…) cada paquete tiene reservados sus
 * mejores archivos, así que uno enorme (un frontend con cientos de componentes) no deja fuera a los demás.
 */
export function selectTopSources<T extends RankCandidate>(items: readonly T[], limit: number): { selected: T[]; skipped: number } {
  const ranked = rankSources(items);
  if (ranked.length <= limit) {
    return { selected: [...ranked].sort((left, right) => left.path.localeCompare(right.path)), skipped: 0 };
  }
  const byPackage = new Map<string, T[]>();
  for (const item of ranked) {
    if (sourceScore(item.path, item.size) < QUOTA_MIN_SCORE) continue;
    const key = packageOf(item.path);
    byPackage.set(key, [...(byPackage.get(key) ?? []), item]);
  }
  const quota = byPackage.size > 1 ? Math.floor((limit * PACKAGE_QUOTA_SHARE) / byPackage.size) : 0;
  const chosen = new Set<T>();
  for (const bucket of byPackage.values()) for (const item of bucket.slice(0, quota)) chosen.add(item);
  for (const item of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(item);
  }
  const selected = [...chosen].sort((left, right) => left.path.localeCompare(right.path));
  return { selected, skipped: Math.max(0, items.length - limit) };
}
