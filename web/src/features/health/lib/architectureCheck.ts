import type { CodeGraph, CodeModule, ModuleRole } from "@core/graph";
import { roleForPath } from "@/features/canvas/lib/architecture";
import { ROLE_LABEL } from "@/features/canvas/theme";
import { isCanvasComponent } from "@/features/canvas/edit/components";
import { isInfraModuleId } from "@/lib/scan/composeScan";
import { buildLevel0 } from "@/features/canvas/lib/level0";
import { prepareGraph } from "@/features/canvas/lib/subsystems";
import type { DriftItem, DriftReport } from "./drift";

/**
 * Architecture Check: hallazgos que salen del grafo (no lint genérico ni SAST). Puro y sin LLM: se recalcula al
 * vuelo sobre el grafo en memoria. Los ítems de drift (`detectDrift`) se traducen a hallazgos `drift-*` para que
 * todo lo que "no cuadra" viva en una sola lista.
 *
 * Dirección de las aristas: `source` importa / llama a `target` (ver `lib/github/buildGraph.ts`).
 */
export type FindingKind = "cycle" | "god-node" | "layer-inversion" | "drift-unmapped" | "drift-stale" | "drift-disconnected";
export type FindingSeverity = "high" | "medium" | "low";
export type CheckLanguage = "es" | "en";

export interface Finding {
  /** Estable entre re-scans del mismo grafo: sirve de `key` y para recordar el hallazgo en un brief. */
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  /** Módulos del lienzo implicados; el primero es el que se destaca al hacer clic. Vacío en `drift-unmapped`. */
  moduleIds: string[];
  title: string;
  why: string;
  fixHint: string;
}

/** Máximo de hallazgos del grafo (ciclos, hubs, inversiones); el drift va aparte y no tiene tope. */
export const MAX_GRAPH_FINDINGS = 10;
const MAX_CYCLES = 4;
/** Con más huérfanos que esto se resumen en un solo hallazgo: 155 tarjetas iguales no ayudan a nadie. */
export const ORPHAN_AGGREGATE_FROM = 5;
/** Rutas de ejemplo en el hallazgo agregado. */
const ORPHAN_SAMPLE = 5;
const MAX_INVERSIONS = 4;
/** Un hub necesita al menos este grado y ser varias veces la media: en grafos pequeños 4 imports no son un "god node". */
const HUB_MIN_DEGREE = 8;
/** En el mapa de sistema (≈15 servicios) un servicio que habla con 6 ya concentra demasiado. */
const SYSTEM_HUB_MIN_DEGREE = 6;
const HUB_MEAN_FACTOR = 3;
/** Archivos que por diseño importa todo el mundo: su fan-in alto no es un olor. */
const SHARED_BY_DESIGN = /(^|\/)(types?|constants?|config|settings|index|__init__)\.[a-z]+$/i;

const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = { high: 0, medium: 1, low: 2 };

/**
 * Capa de cada rol para detectar dependencias al revés: 3 = entrada (HTTP/UI/RPC), 2 = dominio, 1 = datos, 0 = utilidades.
 * `app` (main/server/index) y `code` quedan fuera: los barrels `index.ts` harían saltar falsos positivos.
 */
const LAYER_RANK: Partial<Readonly<Record<ModuleRole, number>>> = {
  api: 3,
  ui: 3,
  rpc: 3,
  service: 2,
  pipeline: 2,
  "ai-model": 2,
  transform: 2,
  prompt: 2,
  stream: 2,
  broker: 2,
  database: 1,
  cache: 1,
  util: 0,
};

type Texts = Readonly<Record<CheckLanguage, string>>;
const t = (lang: CheckLanguage, texts: Texts): string => texts[lang];

function roleOf(item: CodeModule): ModuleRole {
  return item.role ?? roleForPath(item.filePath);
}

/** Aristas únicas entre módulos reales (sin auto-aristas ni duplicados por tipo). */
function adjacency(graph: CodeGraph, ids: ReadonlySet<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const id of ids) out.set(id, new Set());
  for (const edge of graph.edges) {
    if (edge.source === edge.target || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    out.get(edge.source)?.add(edge.target);
  }
  return out;
}

/** Componentes fuertemente conexos de tamaño ≥ 2 (Tarjan iterativo: sin riesgo de desbordar la pila con 400 módulos). */
export function stronglyConnected(out: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const root of out.keys()) {
    if (index.has(root)) continue;
    const work: Array<{ id: string; next: Iterator<string> }> = [];
    const visit = (id: string): void => {
      index.set(id, counter);
      low.set(id, counter);
      counter += 1;
      stack.push(id);
      onStack.add(id);
      work.push({ id, next: (out.get(id) ?? new Set<string>()).values() });
    };
    visit(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const step = frame.next.next();
      if (!step.done) {
        const target = step.value;
        if (!index.has(target)) visit(target);
        else if (onStack.has(target)) low.set(frame.id, Math.min(low.get(frame.id)!, index.get(target)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) !== index.get(frame.id)) continue;
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== frame.id);
      if (component.length >= 2) result.push(component);
    }
  }
  return result;
}

/** Un ciclo concreto dentro del componente (BFS del primero de vuelta a sí mismo), para poder nombrarlo. */
function cyclePath(component: readonly string[], out: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const members = new Set(component);
  const start = [...component].sort()[0]!;
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of out.get(current) ?? []) {
      if (!members.has(next)) continue;
      if (next === start) {
        const path = [current];
        while (path[0] !== start) path.unshift(previous.get(path[0]!)!);
        return path;
      }
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return [start];
}

function cycleFindings(out: ReadonlyMap<string, ReadonlySet<string>>, byId: ReadonlyMap<string, CodeModule>, lang: CheckLanguage): Finding[] {
  return stronglyConnected(out)
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_CYCLES)
    .map((component) => {
      const path = cyclePath(component, out);
      const labels = [...path, path[0]!].map((id) => byId.get(id)?.label ?? id);
      const extra = component.length - path.length;
      return {
        id: `cycle:${[...component].sort().join(",")}`,
        kind: "cycle",
        severity: component.length >= 3 ? "high" : "medium",
        moduleIds: path,
        title: t(lang, {
          es: `Dependencia circular: ${labels.join(" → ")}`,
          en: `Circular dependency: ${labels.join(" → ")}`,
        }),
        why: t(lang, {
          es: `${component.length} módulos se importan en círculo${extra > 0 ? ` (${extra} más en el mismo nudo)` : ""}: ninguno se puede cambiar, probar ni desplegar por separado.`,
          en: `${component.length} modules import each other in a loop${extra > 0 ? ` (${extra} more in the same knot)` : ""}: none can be changed, tested or shipped on its own.`,
        }),
        fixHint: t(lang, {
          es: "Extrae lo compartido a un módulo nuevo o invierte una dependencia con una interfaz/callback.",
          en: "Move the shared piece into a new module, or invert one dependency behind an interface/callback.",
        }),
      };
    });
}

function hubFindings(
  out: ReadonlyMap<string, ReadonlySet<string>>,
  byId: ReadonlyMap<string, CodeModule>,
  lang: CheckLanguage,
  minDegree = HUB_MIN_DEGREE,
  unit: Texts = { es: "módulos", en: "modules" },
): Finding[] {
  const noun = t(lang, unit);
  const fanIn = new Map<string, number>();
  for (const targets of out.values()) for (const target of targets) fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
  const ids = [...out.keys()];
  const meanDegree = ids.length === 0 ? 0 : [...out.values()].reduce((total, targets) => total + targets.size, 0) / ids.length;
  const threshold = Math.max(minDegree, Math.ceil(meanDegree * HUB_MEAN_FACTOR));

  const findings: Finding[] = [];
  const degree = new Map<string, number>();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    // Servicios de infraestructura (MongoDB, Ollama… del compose): que los use medio repo es su trabajo, no un olor.
    if (isInfraModuleId(id)) continue;
    const incoming = SHARED_BY_DESIGN.test(item.filePath) || roleOf(item) === "util" ? 0 : (fanIn.get(id) ?? 0);
    const outgoing = out.get(id)?.size ?? 0;
    const hubIn = incoming >= threshold;
    const hubOut = outgoing >= threshold;
    if (!hubIn && !hubOut) continue;
    const both = hubIn && hubOut;
    degree.set(id, incoming + outgoing);
    findings.push({
      id: `god-node:${id}`,
      kind: "god-node",
      severity: both ? "high" : "medium",
      moduleIds: [id],
      title: both
        ? t(lang, { es: `God node: ${item.label}`, en: `God node: ${item.label}` })
        : hubIn
          ? t(lang, { es: `Hub crítico: ${item.label}`, en: `Critical hub: ${item.label}` })
          : t(lang, { es: `Hace demasiado: ${item.label}`, en: `Does too much: ${item.label}` }),
      why: both
        ? t(lang, {
            es: `Lo usan ${incoming} ${noun} y él depende de ${outgoing}: cualquier cambio se propaga a medio sistema.`,
            en: `${incoming} ${noun} depend on it and it depends on ${outgoing}: any change ripples through half the system.`,
          })
        : hubIn
          ? t(lang, {
              es: `${incoming} ${noun} dependen de él: un cambio en su contrato rompe a todos a la vez.`,
              en: `${incoming} ${noun} depend on it: a change to its contract breaks all of them at once.`,
            })
          : t(lang, {
              es: `Depende de ${outgoing} ${noun}: concentra responsabilidades que deberían estar repartidas.`,
              en: `It depends on ${outgoing} ${noun}: it concentrates responsibilities that belong elsewhere.`,
            }),
      fixHint: hubOut
        ? t(lang, {
            es: "Divídelo por responsabilidad (orquestación vs. lógica) y deja que cada parte importe solo lo suyo.",
            en: "Split it by responsibility (orchestration vs. logic) so each part imports only what it needs.",
          })
        : t(lang, {
            es: "Congela su interfaz pública y cúbrela con tests antes de tocarla; separa lo que cambia a menudo.",
            en: "Freeze its public interface and cover it with tests before touching it; split out the parts that change often.",
          }),
    });
  }
  return findings
    .sort((left, right) => (degree.get(right.moduleIds[0]!) ?? 0) - (degree.get(left.moduleIds[0]!) ?? 0))
    .slice(0, 3);
}

function inversionFindings(graph: CodeGraph, byId: ReadonlyMap<string, CodeModule>, lang: CheckLanguage): Finding[] {
  const bySource = new Map<string, { source: CodeModule; targets: CodeModule[]; worst: number }>();
  for (const edge of graph.edges) {
    // Solo dependencias de código: una llamada HTTP entre servicios (compose, `data-flow`) no invierte capas.
    if (edge.kind !== "imports") continue;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || source.id === target.id) continue;
    const from = LAYER_RANK[roleOf(source)];
    const to = LAYER_RANK[roleOf(target)];
    if (from === undefined || to === undefined || from >= to) continue;
    const entry = bySource.get(source.id) ?? { source, targets: [], worst: 0 };
    if (!entry.targets.some((item) => item.id === target.id)) entry.targets.push(target);
    entry.worst = Math.max(entry.worst, to - from);
    bySource.set(source.id, entry);
  }
  return [...bySource.values()]
    .sort((left, right) => right.worst - left.worst || right.targets.length - left.targets.length)
    .slice(0, MAX_INVERSIONS)
    .map(({ source, targets, worst }) => {
      const first = targets[0]!;
      const others = targets.length - 1;
      const pair = `${roleOf(source)} → ${roleOf(first)}`;
      return {
        id: `layer-inversion:${source.id}`,
        kind: "layer-inversion",
        severity: worst >= 2 ? "high" : "medium",
        moduleIds: [source.id, ...targets.map((item) => item.id)],
        title: t(lang, {
          es: `Capa invertida: ${source.label} → ${first.label}${others > 0 ? ` (+${others})` : ""}`,
          en: `Layer inversion: ${source.label} → ${first.label}${others > 0 ? ` (+${others})` : ""}`,
        }),
        why: t(lang, {
          es: `Una capa baja depende de una alta (${pair}): el núcleo queda atado a la entrada y no se puede reutilizar ni probar solo.`,
          en: `A lower layer depends on a higher one (${pair}): the core is tied to the entry layer and can't be reused or tested alone.`,
        }),
        fixHint: t(lang, {
          es: "Mueve lo que necesita a la capa baja o pásalo como parámetro/interfaz desde arriba.",
          en: "Move what it needs down into the lower layer, or pass it in from above as a parameter/interface.",
        }),
      };
    });
}

const DRIFT_KIND: Readonly<Record<DriftItem["kind"], FindingKind>> = {
  unmapped: "drift-unmapped",
  stale: "drift-stale",
  disconnected: "drift-disconnected",
};

/** «Base de datos (notes · CRUD)»: qué es el módulo huérfano, si el grafo lo sabe. `null` si solo sería "Código". */
function orphanSubject(module: CodeModule | undefined, lang: CheckLanguage): string | null {
  if (!module) return null;
  const role = roleOf(module);
  if (role === "code" && !module.subtitle) return null;
  const label = lang === "es" ? ROLE_LABEL[role] : role.replace("-", " ");
  const noun = label.charAt(0).toUpperCase() + label.slice(1);
  return module.subtitle ? `${noun} (${module.subtitle})` : noun;
}

/** `module`: el módulo del lienzo (stale/disconnected), para nombrar su rol en el texto; no cambia la detección. */
export function driftFinding(item: DriftItem, lang: CheckLanguage, module?: CodeModule): Finding {
  const endpoint = item.endpoint ? t(lang, { es: " (endpoint)", en: " (endpoint)" }) : "";
  const subject = item.kind === "disconnected" ? orphanSubject(module, lang) : null;
  const texts: Readonly<Record<DriftItem["kind"], { title: Texts; why: Texts; fixHint: Texts }>> = {
    unmapped: {
      title: { es: `Sin mapear: ${item.label}${endpoint}`, en: `Not on the map: ${item.label}${endpoint}` },
      why: {
        es: "El archivo existe en el código pero ningún módulo del lienzo lo representa: el mapa miente por omisión.",
        en: "The file exists in the code but no module on the canvas represents it: the map is lying by omission.",
      },
      fixHint: { es: "Vuelve a importar el repo o sincroniza con el IDE para añadirlo.", en: "Re-import the repo or sync with the IDE to add it." },
    },
    stale: {
      title: { es: `Ya no existe: ${item.label}${endpoint}`, en: `No longer exists: ${item.label}${endpoint}` },
      why: {
        es: "El lienzo muestra un módulo cuyo archivo ya no está en el workspace.",
        en: "The canvas shows a module whose file is no longer in the workspace.",
      },
      fixHint: { es: "Vuelve a importar el repo para quitarlo del mapa.", en: "Re-import the repo to drop it from the map." },
    },
    disconnected: {
      title: { es: `Huérfano: ${item.label}${endpoint}`, en: `Orphan: ${item.label}${endpoint}` },
      why: subject
        ? {
            es: `${subject}: nadie importa este módulo y él no importa a nadie, así que el lienzo lo oculta. O es código muerto o se carga de forma dinámica.`,
            en: `${subject}: nothing imports this module and it imports nothing, so the canvas hides it. Either dead code or loaded dynamically.`,
          }
        : {
            es: "Nadie lo importa y no importa a nadie: el lienzo lo oculta. O es código muerto o se carga de forma dinámica.",
            en: "Nothing imports it and it imports nothing: the canvas hides it. Either dead code or loaded dynamically.",
          },
      fixHint: {
        es: "Si es código muerto, bórralo; si se registra dinámicamente (plugins, rutas por convención), documenta dónde.",
        en: "If it's dead code, delete it; if it's registered dynamically (plugins, convention routes), document where.",
      },
    },
  };
  const text = texts[item.kind];
  return {
    id: `${DRIFT_KIND[item.kind]}:${item.id}`,
    kind: DRIFT_KIND[item.kind],
    severity: item.endpoint ? "high" : item.kind === "disconnected" ? "low" : "medium",
    moduleIds: item.kind === "unmapped" ? [] : [item.id],
    title: t(lang, text.title),
    why: t(lang, text.why),
    fixHint: t(lang, text.fixHint),
  };
}

/**
 * Muchos huérfanos → un solo hallazgo con el recuento, el tamaño del núcleo conectado y unas rutas de ejemplo
 * (primero los que parecen endpoints). `connected`: módulos que sí se ven en el lienzo.
 */
export function orphanSummaryFinding(items: readonly DriftItem[], connected: number, lang: CheckLanguage): Finding {
  const endpoints = items.filter((item) => item.endpoint).length;
  const sample = items.slice(0, ORPHAN_SAMPLE).map((item) => item.filePath);
  const more = items.length - sample.length;
  const list = `${sample.join(", ")}${more > 0 ? t(lang, { es: ` y ${more} más`, en: ` and ${more} more` }) : ""}`;
  return {
    id: "drift-disconnected:aggregate",
    kind: "drift-disconnected",
    severity: endpoints > 0 ? "medium" : "low",
    moduleIds: [],
    title: t(lang, {
      es: `${items.length} módulos sin dependencias en el mapa (núcleo conectado = ${connected})`,
      en: `${items.length} modules with no dependencies on the map (connected core = ${connected})`,
    }),
    why: t(lang, {
      es: `Nadie los importa y no importan a nadie, así que el lienzo los oculta${endpoints > 0 ? ` (${endpoints} parecen endpoints)` : ""}: scripts sueltos, tests, código muerto o cargado de forma dinámica. Por ejemplo: ${list}.`,
      en: `Nothing imports them and they import nothing, so the canvas hides them${endpoints > 0 ? ` (${endpoints} look like endpoints)` : ""}: standalone scripts, tests, dead code or dynamically loaded code. For example: ${list}.`,
    }),
    fixHint: t(lang, {
      es: "Revisa primero los endpoints; lo que sea código muerto, bórralo, y lo que se cargue por convención (plugins, rutas), documéntalo.",
      en: "Check the endpoints first; delete what's dead code and document what's loaded by convention (plugins, routes).",
    }),
  };
}

export function isDriftFinding(finding: Pick<Finding, "kind">): boolean {
  return finding.kind.startsWith("drift-");
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      Number(isDriftFinding(left)) - Number(isDriftFinding(right)) ||
      left.title.localeCompare(right.title),
  );
}

/**
 * Qué se enseña según el plan: todo el drift (ya era gratis) y los `graphLimit` primeros hallazgos del grafo;
 * `locked` son los que quedan detrás de Pro.
 */
export function splitForPlan(findings: readonly Finding[], graphLimit: number): { visible: Finding[]; locked: number } {
  let shown = 0;
  let locked = 0;
  const visible = findings.filter((finding) => {
    if (isDriftFinding(finding)) return true;
    if (shown < graphLimit) {
      shown += 1;
      return true;
    }
    locked += 1;
    return false;
  });
  return { visible, locked };
}

/**
 * Grafo de sistema para el Check: un módulo por nodo del esqueleto de Level 0 (servicio o infra, con el id de su
 * módulo representativo para poder destacarlo) y una arista por dependencia entre nodos. null si el mapa no es de
 * sistema (sin compose): entonces el Check mira los archivos, como siempre.
 */
export function systemGraphFor(graph: CodeGraph): CodeGraph | null {
  const level0 = buildLevel0(prepareGraph(graph));
  if (level0.style !== "system") return null;
  const byId = new Map(graph.modules.map((item) => [item.id, item]));
  const idOf = new Map<string, string>();
  const modules: CodeModule[] = [];
  for (const block of level0.blocks) {
    const id = block.primaryModuleId ?? block.moduleIds[0];
    const base = id ? byId.get(id) : undefined;
    if (!id || !base) continue;
    idOf.set(block.id, id);
    modules.push({ ...base, label: block.label, role: block.role });
  }
  const edges = level0.edges.flatMap((edge) => {
    const source = idOf.get(edge.source);
    const target = idOf.get(edge.target);
    return source && target ? [{ id: `system:${source}:${target}`, source, target, kind: "calls" as const }] : [];
  });
  return { ...graph, modules, edges };
}

/**
 * Hallazgos del grafo (ciclos, hubs, capas invertidas) más el drift, ordenados por gravedad.
 *
 * Con un mapa de sistema (compose), el Check mira los servicios: ciclos y hubs *entre servicios*; los hubs entre
 * archivos internos de un servicio (su agente, sus herramientas) no son un problema de arquitectura, y los módulos
 * sin dependencias ya no están en el mapa (`pruneNonArchitectural`), así que no se tratan como error.
 */
export function architectureCheck(graph: CodeGraph, options: { drift?: DriftReport | null; lang?: CheckLanguage } = {}): Finding[] {
  const lang = options.lang ?? "es";
  const system = systemGraphFor({ ...graph, modules: graph.modules.filter((item) => !isCanvasComponent(item.id)) });
  const scope = system ?? graph;
  const real = scope.modules.filter((item) => !isCanvasComponent(item.id));
  const byId = new Map(real.map((item) => [item.id, item]));
  const out = adjacency(scope, new Set(byId.keys()));
  const fromGraph = sortFindings([
    ...cycleFindings(out, byId, lang),
    ...(system
      ? hubFindings(out, byId, lang, SYSTEM_HUB_MIN_DEGREE, { es: "servicios", en: "services" })
      : hubFindings(out, byId, lang)),
    ...(system ? [] : inversionFindings(scope, byId, lang)),
  ]).slice(0, MAX_GRAPH_FINDINGS);
  // Mapa de sistema: los archivos que no están en el mapa (SPA, scripts, tests: «sin mapear») y los sueltos no son un
  // fallo de arquitectura; lo que sí se avisa es lo que el mapa enseña y ya no existe en el código.
  const driftItems = (options.drift?.items ?? []).filter((item) => !system || item.kind === "stale");
  const orphans = driftItems.filter((item) => item.kind === "disconnected");
  const aggregate = orphans.length > ORPHAN_AGGREGATE_FROM;
  const fromDrift = driftItems
    .filter((item) => !aggregate || item.kind !== "disconnected")
    .map((item) => driftFinding(item, lang, byId.get(item.id)));
  if (aggregate) fromDrift.push(orphanSummaryFinding(orphans, Math.max(0, graph.modules.length - orphans.length), lang));
  return sortFindings([...fromGraph, ...fromDrift]);
}
