import type { GraphPosition, LayeredLayout } from "./layout";
import { portAnchor, slotAnchor, type PortPair, type PortSide, type PortSlot, type Rect } from "./ports";
import type { PreparedGraph } from "./subsystems";
import { CARD_HEIGHT, CARD_WIDTH, SUPPORT_LABEL, SUPPORT_SIZE, SUPPORT_SLOT } from "../theme";

export const ROUTING = {
  /** Aire alrededor de cada tarjeta que ninguna arista ajena puede pisar. */
  cardPad: 14,
  /** Tramo mínimo recto al salir/entrar de un puerto antes del primer codo. */
  stub: 20,
  /** Un codo "cuesta" como este tramo recto: prefiere rutas con pocos giros. */
  bendCost: 48,
  /** Pasillo exterior alrededor de todo el lienzo (rodeos de último recurso y pliegues). */
  outerMargin: 40,
  /**
   * Recargo por recorrer líneas auxiliares (los tramos de salida/entrada) en lugar del centro de un
   * pasillo o de un hueco entre filas: los codos caen donde luego se reparten en carriles.
   */
  offLanePenalty: 0.5,
  /** Separación máxima entre cables paralelos que comparten pasillo o hueco entre filas. */
  laneGap: 10,
  /** Cuánto puede apartarse un carril de la línea que eligió el router (px, a cada lado). */
  laneSpread: 40,
} as const;

export interface RoutableEdge {
  id: string;
  source: string;
  target: string;
  ports: PortPair;
  /** Ranura en cada extremo (ver `assignPortSlots`); sin ella el cable sale del centro del lado. */
  slots?: { source: PortSlot; target: PortSlot };
}

interface Obstacle extends Rect {
  /** Módulo (tarjeta o sub-nodo) o id de caja de subsistema. */
  owner: string;
  kind: "card" | "box";
}

interface Corridor {
  lo: number;
  hi: number;
}

/** Rect absoluto de cada tarjeta y sub-nodo visible (sin márgenes). */
export function nodeRects(prepared: PreparedGraph, layout: LayeredLayout): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const item of prepared.graph.modules) {
    const position = layout.positions.get(item.id);
    if (!position) continue;
    const size = item.supportOf === undefined ? { width: CARD_WIDTH, height: CARD_HEIGHT } : { width: SUPPORT_SIZE, height: SUPPORT_SIZE };
    rects.set(item.id, { ...position, ...size });
  }
  return rects;
}

/**
 * Rutas ortogonales que no cruzan tarjetas ni cajas ajenas. Devuelve, por `edge.id`, la
 * polilínea completa (anclaje de origen, codos, anclaje de destino). Sin ruta posible la
 * arista no aparece en el mapa y el componente cae en su smoothstep por defecto.
 *
 * Las cajas de subsistema son obstáculos opacos salvo para las aristas con un extremo dentro:
 * así un cable Entrada → Servicios rodea el RAG Core por el pasillo en lugar de atravesarlo.
 */
export function routeLayeredEdges(
  prepared: PreparedGraph,
  layout: LayeredLayout,
  edges: readonly RoutableEdge[],
): Map<string, GraphPosition[]> {
  const rects = nodeRects(prepared, layout);
  const obstacles = buildObstacles(prepared, rects, layout);
  const bounds = outerBounds(obstacles);
  const corridors = freeGaps(obstacles.map((item) => [item.x, item.x + item.width]));
  const xs = [...corridors.map((gap) => (gap.lo + gap.hi) / 2), bounds.left - ROUTING.outerMargin, bounds.right + ROUTING.outerMargin];
  const ys = [...laneYs(obstacles), bounds.top - ROUTING.outerMargin, bounds.bottom + ROUTING.outerMargin];

  const routes = new Map<string, GraphPosition[]>();
  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target || edge.source === edge.target) continue;
    const excluded = new Set([edge.source, edge.target]);
    for (const id of [edge.source, edge.target]) {
      const box = prepared.subsystemOf.get(id);
      if (box) excluded.add(`box:${box}`);
    }
    // Los extremos cuentan sin margen: la ruta puede tocar su borde, nunca atravesarlos.
    const blockers = [
      ...obstacles.filter((item) => !excluded.has(item.owner)),
      { ...source, owner: edge.source, kind: "card" as const },
      { ...target, owner: edge.target, kind: "card" as const },
    ];
    const start = edge.slots ? slotAnchor(source, edge.slots.source) : portAnchor(source, edge.ports.source);
    const end = edge.slots ? slotAnchor(target, edge.slots.target) : portAnchor(target, edge.ports.target);
    const path = routeOne(start, edge.ports.source, end, edge.ports.target, xs, ys, blockers);
    if (!path) continue;
    routes.set(edge.id, path);
  }
  spreadLanes(routes, "vertical", obstacles);
  spreadLanes(routes, "horizontal", obstacles);
  return routes;
}

/** Caja de un nodo del mapa de sistema (Level 0) para enrutar aristas. */
export interface SystemNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rutas del mapa de sistema: **recta** si el segmento origen→destino no atraviesa otra tarjeta;
 * si no, polilínea ortogonal que las esquiva (mismo motor que el grafo por capas).
 * Los nodos L0 solo tienen asa derecha (salida) e izquierda (entrada).
 */
export function routeSystemEdges(
  nodes: readonly SystemNodeBox[],
  edges: readonly { id: string; source: string; target: string }[],
): Map<string, GraphPosition[]> {
  const pad = ROUTING.cardPad;
  const rects = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height } as Rect]));
  const obstacles: Obstacle[] = nodes.map((node) => ({
    owner: node.id,
    kind: "card",
    x: node.x - pad,
    y: node.y - pad,
    width: node.width + 2 * pad,
    height: node.height + 2 * pad,
  }));
  if (obstacles.length === 0) return new Map();
  const bounds = outerBounds(obstacles);
  const corridors = freeGaps(obstacles.map((item) => [item.x, item.x + item.width]));
  const xs = [...corridors.map((gap) => (gap.lo + gap.hi) / 2), bounds.left - ROUTING.outerMargin, bounds.right + ROUTING.outerMargin];
  const ys = [...laneYs(obstacles), bounds.top - ROUTING.outerMargin, bounds.bottom + ROUTING.outerMargin];

  const routes = new Map<string, GraphPosition[]>();
  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target || edge.source === edge.target) continue;
    // Asas L0: salida derecha → entrada izquierda (SubsystemNode solo tiene esos handles).
    const pair: PortPair = { source: "right", target: "left" };
    const start = portAnchor(source, pair.source);
    const end = portAnchor(target, pair.target);
    const others = obstacles.filter((item) => item.owner !== edge.source && item.owner !== edge.target);
    // Disparo limpio: recta (aunque no sea ortogonal). Es lo que se pide cuando no hay que esquivar.
    if (!segmentHitsAny(start, end, others)) {
      routes.set(edge.id, simplify([start, end]));
      continue;
    }
    const blockers = [
      ...others,
      { ...source, owner: edge.source, kind: "card" as const },
      { ...target, owner: edge.target, kind: "card" as const },
    ];
    const path = routeOne(start, pair.source, end, pair.target, xs, ys, blockers);
    if (path) routes.set(edge.id, path);
  }
  spreadLanes(routes, "vertical", obstacles);
  spreadLanes(routes, "horizontal", obstacles);
  return routes;
}

/**
 * true si el segmento `a→b` corta el interior de algún rectángulo (esquivar). Los bordes rozados
 * no cuentan: el cable puede salir/entrar del puerto sin considerarse choque.
 */
export function segmentHitsAny(a: GraphPosition, b: GraphPosition, obstacles: readonly Rect[]): boolean {
  for (const item of obstacles) {
    if (segmentHitsRect(a, b, item)) return true;
  }
  return false;
}

function segmentHitsRect(a: GraphPosition, b: GraphPosition, rect: Rect): boolean {
  const pad = 1;
  const left = rect.x + pad;
  const right = rect.x + rect.width - pad;
  const top = rect.y + pad;
  const bottom = rect.y + rect.height - pad;
  if (right <= left || bottom <= top) return false;
  // Ambos extremos fuera del mismo lado → no corta.
  if ((a.x <= left && b.x <= left) || (a.x >= right && b.x >= right) || (a.y <= top && b.y <= top) || (a.y >= bottom && b.y >= bottom)) {
    return false;
  }
  // Un extremo dentro → atraviesa (salvo que ambos estén en el borde de puerto, ya filtrado por pad).
  const inside = (point: GraphPosition) => point.x > left && point.x < right && point.y > top && point.y < bottom;
  if (inside(a) || inside(b)) return true;
  // Liang–Barsky: el segmento cruza el interior del AABB.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - left) && clip(dx, right - a.x) && clip(-dy, a.y - top) && clip(dy, bottom - a.y) && t0 < t1;
}

function buildObstacles(prepared: PreparedGraph, rects: ReadonlyMap<string, Rect>, layout: LayeredLayout): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const pad = ROUTING.cardPad;
  for (const item of prepared.graph.modules) {
    const rect = rects.get(item.id);
    if (!rect) continue;
    if (item.supportOf === undefined) {
      obstacles.push({ owner: item.id, kind: "card", x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad });
      continue;
    }
    // Sub-nodo: círculo + etiqueta de dos líneas debajo, en su ranura.
    const slotX = rect.x - (SUPPORT_SLOT - SUPPORT_SIZE) / 2;
    obstacles.push({ owner: item.id, kind: "card", x: slotX, y: rect.y - pad, width: SUPPORT_SLOT, height: SUPPORT_SIZE + SUPPORT_LABEL + pad });
  }
  for (const box of layout.boxes) {
    obstacles.push({ owner: `box:${box.id}`, kind: "box", x: box.x, y: box.y, width: box.width, height: box.height });
  }
  return obstacles;
}

function outerBounds(obstacles: readonly Rect[]) {
  if (obstacles.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    left: Math.min(...obstacles.map((item) => item.x)),
    right: Math.max(...obstacles.map((item) => item.x + item.width)),
    top: Math.min(...obstacles.map((item) => item.y)),
    bottom: Math.max(...obstacles.map((item) => item.y + item.height)),
  };
}

/** Huecos libres entre intervalos (fusionados) sobre un eje: los pasillos. */
function freeGaps(intervals: ReadonlyArray<readonly [number, number]>): Corridor[] {
  const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
  const gaps: Corridor[] = [];
  let end = -Infinity;
  for (const [lo, hi] of sorted) {
    if (lo > end && end !== -Infinity) gaps.push({ lo: end, hi: lo });
    end = Math.max(end, hi);
  }
  return gaps;
}

/**
 * Carriles horizontales candidatos: huecos entre filas dentro de cada columna (banda X de
 * obstáculos fusionados) y huecos que cruzan todo el lienzo (p. ej. entre pliegues).
 */
function laneYs(obstacles: readonly Obstacle[]): number[] {
  const ys = freeGaps(obstacles.map((item) => [item.y, item.y + item.height])).map((gap) => (gap.lo + gap.hi) / 2);
  const bands: Array<{ lo: number; hi: number; members: Obstacle[] }> = [];
  for (const item of [...obstacles].sort((left, right) => left.x - right.x)) {
    const band = bands[bands.length - 1];
    if (band && item.x < band.hi) {
      band.hi = Math.max(band.hi, item.x + item.width);
      band.members.push(item);
    } else {
      bands.push({ lo: item.x, hi: item.x + item.width, members: [item] });
    }
  }
  for (const band of bands) {
    for (const gap of freeGaps(band.members.map((item) => [item.y, item.y + item.height]))) ys.push((gap.lo + gap.hi) / 2);
  }
  return ys;
}

type Dir = 0 | 1 | 2 | 3; // +x, +y, -x, -y
const STEP: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const OUTWARD: Readonly<Record<PortSide, Dir>> = { right: 0, bottom: 1, left: 2, top: 3 };
const reverse = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;

function blocked(a: GraphPosition, b: GraphPosition, obstacles: readonly Rect[]): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  for (const item of obstacles) {
    if (a.y === b.y) {
      if (a.y > item.y && a.y < item.y + item.height && maxX > item.x && minX < item.x + item.width) return true;
    } else if (a.x > item.x && a.x < item.x + item.width && maxY > item.y && minY < item.y + item.height) {
      return true;
    }
  }
  return false;
}

/**
 * A* sobre la rejilla de líneas candidatas. El estado incluye la dirección de avance para
 * cobrar los codos y para obligar a salir por el lado del puerto y entrar por el del destino.
 */
function routeOne(
  start: GraphPosition,
  startSide: PortSide,
  end: GraphPosition,
  endSide: PortSide,
  baseXs: readonly number[],
  baseYs: readonly number[],
  obstacles: readonly Rect[],
): GraphPosition[] | null {
  const out = OUTWARD[startSide];
  const arrive = reverse(OUTWARD[endSide]);
  const stubOf = (point: GraphPosition, dir: Dir) => ({ x: point.x + STEP[dir]![0] * ROUTING.stub, y: point.y + STEP[dir]![1] * ROUTING.stub });
  const startStub = stubOf(start, out);
  const endStub = stubOf(end, OUTWARD[endSide]);
  const unique = (values: number[]) => [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
  const xs = unique([...baseXs, start.x, end.x, startStub.x, endStub.x]);
  const ys = unique([...baseYs, start.y, end.y, startStub.y, endStub.y]);
  const vertical = (side: PortSide) => side === "top" || side === "bottom";
  // Líneas "buenas": pasillos, huecos entre filas y la recta natural de cada puerto.
  // Un cable que sale y entra por el mismo lado horizontal (right→right en una pila) hace una "C": su
  // carril natural es la línea de sus tramos de salida/entrada, pegada a la columna, no el pasillo exterior.
  const hugsColumn = startSide === endSide && !vertical(startSide);
  const laneX = new Set(
    unique([
      ...baseXs,
      ...(vertical(startSide) ? [start.x] : []),
      ...(vertical(endSide) ? [end.x] : []),
      ...(hugsColumn ? [startStub.x, endStub.x] : []),
    ]),
  );
  const laneY = new Set(unique([...baseYs, ...(vertical(startSide) ? [] : [start.y]), ...(vertical(endSide) ? [] : [end.y])]));
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  const round = (value: number) => Math.round(value * 100) / 100;
  const sx = xIndex.get(round(start.x));
  const sy = yIndex.get(round(start.y));
  const tx = xIndex.get(round(end.x));
  const ty = yIndex.get(round(end.y));
  if (sx === undefined || sy === undefined || tx === undefined || ty === undefined) return null;

  const width = xs.length;
  const key = (ix: number, iy: number, dir: Dir) => ((iy * width + ix) << 2) | dir;
  const point = (ix: number, iy: number): GraphPosition => ({ x: xs[ix] as number, y: ys[iy] as number });
  const heuristic = (ix: number, iy: number) => Math.abs((xs[ix] as number) - end.x) + Math.abs((ys[iy] as number) - end.y);

  const best = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new MinHeap();
  const startKey = key(sx, sy, out);
  best.set(startKey, 0);
  heap.push(heuristic(sx, sy), startKey);
  const segmentCache = new Map<string, boolean>();

  while (heap.size > 0) {
    const current = heap.pop() as number;
    const dir = (current & 3) as Dir;
    const cell = current >> 2;
    const ix = cell % width;
    const iy = Math.floor(cell / width);
    const cost = best.get(current) ?? Infinity;
    if (ix === tx && iy === ty && dir === arrive && current !== startKey) return unwind(current, parent, width, point);

    const atStart = ix === sx && iy === sy && current === startKey;
    for (const next of [0, 1, 2, 3] as Dir[]) {
      if (next === reverse(dir)) continue;
      if (atStart && next !== out) continue;
      const nx = ix + STEP[next]![0];
      const ny = iy + STEP[next]![1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= ys.length) continue;
      const segment = `${ix},${iy},${nx},${ny}`;
      let isBlocked = segmentCache.get(segment);
      if (isBlocked === undefined) {
        isBlocked = blocked(point(ix, iy), point(nx, ny), obstacles);
        segmentCache.set(segment, isBlocked);
      }
      if (isBlocked) continue;
      const along = next % 2 === 0 ? laneY.has(ys[iy] as number) : laneX.has(xs[ix] as number);
      const length =
        (Math.abs((xs[nx] as number) - (xs[ix] as number)) + Math.abs((ys[ny] as number) - (ys[iy] as number))) *
        (along ? 1 : 1 + ROUTING.offLanePenalty);
      const total = cost + length + (next === dir ? 0 : ROUTING.bendCost);
      const nextKey = key(nx, ny, next);
      if (total >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, total);
      parent.set(nextKey, current);
      heap.push(total + heuristic(nx, ny), nextKey);
    }
  }
  return null;
}

function unwind(
  last: number,
  parent: ReadonlyMap<number, number>,
  width: number,
  point: (ix: number, iy: number) => GraphPosition,
): GraphPosition[] {
  const cells: GraphPosition[] = [];
  for (let current: number | undefined = last; current !== undefined; current = parent.get(current)) {
    const cell = current >> 2;
    cells.push(point(cell % width, Math.floor(cell / width)));
  }
  return simplify(cells.reverse());
}

/** Quita puntos repetidos y los intermedios de tramos rectos: solo quedan extremos y codos. */
export function simplify(points: readonly GraphPosition[]): GraphPosition[] {
  const deduped = points.filter((item, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== item.x || previous.y !== item.y;
  });
  return deduped.filter((item, index) => {
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    if (!previous || !next) return true;
    return !((previous.x === item.x && item.x === next.x) || (previous.y === item.y && item.y === next.y));
  });
}

type Axis = "vertical" | "horizontal";

/** Tramo interior de una ruta sobre una línea: `line` es su X (vertical) o su Y (horizontal). */
export interface LaneSegment {
  edge: string;
  index: number;
  line: number;
  /** Extremos a lo largo del tramo. */
  a: number;
  b: number;
  /** Hacia qué lado de la línea sale el tramo anterior (en `a`) y el siguiente (en `b`): -1 o +1. */
  sideA: number;
  sideB: number;
}

/**
 * Reparte en carriles paralelos los tramos interiores que comparten línea y se solapan, uno por
 * arista, para que dos cables nunca vayan superpuestos (ni siquiera los del mismo origen). El orden
 * dentro de cada haz minimiza cruces y el haz se acota al espacio libre entre obstáculos, así que
 * desplazar un tramo nunca lo mete en una tarjeta ni en una caja. El primer y el último tramo
 * (los que tocan los puertos) no se mueven.
 */
function spreadLanes(routes: Map<string, GraphPosition[]>, axis: Axis, obstacles: readonly Rect[]): void {
  const byLine = new Map<number, LaneSegment[]>();
  for (const [edge, points] of routes) {
    for (let index = 1; index < points.length - 2; index += 1) {
      const segment = readSegment(edge, points, index, axis);
      if (!segment) continue;
      const key = Math.round(segment.line * 100) / 100;
      byLine.set(key, [...(byLine.get(key) ?? []), segment]);
    }
  }
  for (const segments of byLine.values()) {
    for (const bundle of overlappingBundles(segments)) {
      if (bundle.length < 2) continue;
      placeBundle(bundle, routes, axis, obstacles);
    }
  }
}

function readSegment(edge: string, points: readonly GraphPosition[], index: number, axis: Axis): LaneSegment | null {
  const before = points[index - 1] as GraphPosition;
  const a = points[index] as GraphPosition;
  const b = points[index + 1] as GraphPosition;
  const after = points[index + 2] as GraphPosition;
  if (axis === "vertical") {
    if (a.x !== b.x || a.y === b.y) return null;
    return { edge, index, line: a.x, a: a.y, b: b.y, sideA: Math.sign(before.x - a.x), sideB: Math.sign(after.x - b.x) };
  }
  if (a.y !== b.y || a.x === b.x) return null;
  return { edge, index, line: a.y, a: a.x, b: b.x, sideA: Math.sign(before.y - a.y), sideB: Math.sign(after.y - b.y) };
}

const spanOf = (segment: LaneSegment) => [Math.min(segment.a, segment.b), Math.max(segment.a, segment.b)] as const;

/** Grupos de tramos sobre la misma línea cuyos recorridos se solapan (tocarse en un punto no cuenta). */
function overlappingBundles(segments: readonly LaneSegment[]): LaneSegment[][] {
  const sorted = [...segments].sort((left, right) => spanOf(left)[0] - spanOf(right)[0]);
  const bundles: LaneSegment[][] = [];
  let reach = -Infinity;
  for (const segment of sorted) {
    const [lo, hi] = spanOf(segment);
    const current = bundles[bundles.length - 1];
    if (current && lo < reach) {
      current.push(segment);
      reach = Math.max(reach, hi);
    } else {
      bundles.push([segment]);
      reach = hi;
    }
  }
  return bundles;
}

function placeBundle(bundle: LaneSegment[], routes: Map<string, GraphPosition[]>, axis: Axis, obstacles: readonly Rect[]): void {
  const line = bundle[0]?.line ?? 0;
  const spanLo = Math.min(...bundle.map((item) => spanOf(item)[0]));
  const spanHi = Math.max(...bundle.map((item) => spanOf(item)[1]));
  let lo = line - ROUTING.laneSpread;
  let hi = line + ROUTING.laneSpread;
  for (const item of obstacles) {
    const [alongLo, alongHi, crossLo, crossHi] =
      axis === "vertical"
        ? [item.y, item.y + item.height, item.x, item.x + item.width]
        : [item.x, item.x + item.width, item.y, item.y + item.height];
    if (alongHi <= spanLo || alongLo >= spanHi) continue;
    if (crossHi <= line) lo = Math.max(lo, crossHi);
    else if (crossLo >= line) hi = Math.min(hi, crossLo);
    // Un obstáculo que contiene la línea es un extremo propio del cable (o su caja): no limita el haz.
  }
  const gap = Math.min(ROUTING.laneGap, (hi - lo) / (bundle.length + 1));
  if (gap < 2) return;
  const half = ((bundle.length - 1) / 2) * gap;
  const center = Math.min(Math.max(line, lo + gap / 2 + half), hi - gap / 2 - half);
  leastCrossingOrder(bundle).forEach((segment, lane) => {
    const value = center - half + lane * gap;
    const points = routes.get(segment.edge);
    if (!points) return;
    for (const at of [segment.index, segment.index + 1]) {
      const point = points[at] as GraphPosition;
      points[at] = axis === "vertical" ? { ...point, x: value } : { ...point, y: value };
    }
  });
}

/** Cruces que provoca colocar `low` en un carril inferior (más a la izquierda / más arriba) que `high`. */
function crossingCost(low: LaneSegment, high: LaneSegment): number {
  const inside = (value: number, segment: LaneSegment) => {
    const [from, to] = spanOf(segment);
    return value > from && value < to;
  };
  let cost = 0;
  // Los tramos de conexión de `high` que vuelven hacia el lado bajo atraviesan el carril de `low`, y viceversa.
  if (high.sideA < 0 && inside(high.a, low)) cost += 1;
  if (high.sideB < 0 && inside(high.b, low)) cost += 1;
  if (low.sideA > 0 && inside(low.a, high)) cost += 1;
  if (low.sideB > 0 && inside(low.b, high)) cost += 1;
  return cost;
}

/** Orden de carriles con menos cruces: exhaustivo hasta 7 cables, inserción voraz por encima. */
export function leastCrossingOrder(bundle: readonly LaneSegment[]): LaneSegment[] {
  const initial = [...bundle].sort(
    (left, right) => (left.a + left.b) / 2 - (right.a + right.b) / 2 || left.edge.localeCompare(right.edge),
  );
  const total = (order: readonly LaneSegment[]) => {
    let sum = 0;
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) sum += crossingCost(order[i] as LaneSegment, order[j] as LaneSegment);
    }
    return sum;
  };
  if (initial.length <= 7) {
    let best = initial;
    let bestCost = total(initial);
    const visit = (prefix: LaneSegment[], rest: LaneSegment[]) => {
      if (bestCost === 0) return;
      if (rest.length === 0) {
        const cost = total(prefix);
        if (cost < bestCost) {
          best = prefix;
          bestCost = cost;
        }
        return;
      }
      rest.forEach((item, index) => visit([...prefix, item], [...rest.slice(0, index), ...rest.slice(index + 1)]));
    };
    visit([], initial);
    return best;
  }
  const order: LaneSegment[] = [];
  for (const item of initial) {
    let bestAt = order.length;
    let bestCost = Infinity;
    for (let at = 0; at <= order.length; at += 1) {
      const cost = total([...order.slice(0, at), item, ...order.slice(at)]);
      if (cost < bestCost) {
        bestCost = cost;
        bestAt = at;
      }
    }
    order.splice(bestAt, 0, item);
  }
  return order;
}

/** Montículo binario mínimo de claves numéricas por prioridad. */
class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(priority: number, value: number) {
    this.priorities.push(priority);
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const up = (index - 1) >> 1;
      if ((this.priorities[up] as number) <= priority) break;
      this.swap(index, up);
      index = up;
    }
  }

  pop(): number | undefined {
    if (this.values.length === 0) return undefined;
    const top = this.values[0];
    const lastPriority = this.priorities.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.values.length > 0) {
      this.priorities[0] = lastPriority;
      this.values[0] = lastValue;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.values.length && (this.priorities[left] as number) < (this.priorities[smallest] as number)) smallest = left;
        if (right < this.values.length && (this.priorities[right] as number) < (this.priorities[smallest] as number)) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.priorities[a], this.priorities[b]] = [this.priorities[b] as number, this.priorities[a] as number];
    [this.values[a], this.values[b]] = [this.values[b] as number, this.values[a] as number];
  }
}
