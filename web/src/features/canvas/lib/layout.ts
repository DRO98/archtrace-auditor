import dagre, { type NodeLabel } from "@dagrejs/dagre";
import type { CodeGraph, CodeModule, GroupColor, ModuleSubsystem } from "@core/graph";
import { intraSubsystemRank, UNRANKED, type PreparedGraph } from "./subsystems";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SUPPORT_GAP,
  SUPPORT_SIZE,
  SUPPORT_SLOT,
  footprint,
} from "../theme";

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphLayout {
  positions: Map<string, GraphPosition>;
  /** Puntos intermedios que dagre reserva a cada arista, por par `origen→destino`. */
  routes: Map<string, GraphPosition[]>;
}

export const routeKey = (source: string, target: string): string => `${source}→${target}`;

export function layoutGraph(graph: CodeGraph): Map<string, GraphPosition> {
  return layoutGraphWithRoutes(graph).positions;
}

/**
 * Jerarquía izquierda→derecha. Separación amplia entre capas (ranksep) y entre
 * nodos/aristas (nodesep, edgesep) para que las curvas tengan carril propio.
 */
export function layoutGraphWithRoutes(graph: CodeGraph): GraphLayout {
  const principals = graph.modules.filter((item) => item.supportOf === undefined);
  const principalIds = new Set(principals.map((item) => item.id));
  const supportsByParent = new Map<string, CodeModule[]>();
  for (const item of graph.modules) {
    if (item.supportOf === undefined || !principalIds.has(item.supportOf)) continue;
    const list = supportsByParent.get(item.supportOf);
    if (list) list.push(item);
    else supportsByParent.set(item.supportOf, [item]);
  }

  const laid = new dagre.graphlib.Graph<Record<string, unknown>, NodeLabel, Record<string, unknown>>();
  laid.setDefaultEdgeLabel(() => ({}));
  laid.setGraph({
    rankdir: "LR",
    ranker: "tight-tree", // compacta por niveles: sin huecos de rango ni lienzo innecesariamente ancho
    nodesep: 88, // ≥ 80: aire vertical entre tarjetas de la misma capa
    ranksep: 200, // 180–220: canal horizontal para la etiqueta del cable
    edgesep: 32,
    marginx: 24,
    marginy: 24,
  });

  for (const item of principals) {
    const box = footprint(supportsByParent.get(item.id)?.length ?? 0);
    laid.setNode(item.id, { width: box.width, height: box.height });
  }
  // Las aristas hacia sub-nodos se proyectan sobre su tarjeta: así dagre las
  // tiene en cuenta al ordenar cada capa y reduce cruces.
  const parentOf = new Map(graph.modules.map((item) => [item.id, item.supportOf]));
  const owner = (id: string): string | null => {
    if (principalIds.has(id)) return id;
    const parent = parentOf.get(id);
    return parent !== undefined && principalIds.has(parent) ? parent : null;
  };
  const drawn = new Set<string>();
  for (const edge of graph.edges) {
    if (principalIds.has(edge.source) && principalIds.has(edge.target) && edge.source !== edge.target) {
      drawn.add(routeKey(edge.source, edge.target));
    }
  }
  for (const edge of graph.edges) {
    const source = owner(edge.source);
    const target = owner(edge.target);
    if (!source || !target || source === target) continue;
    const key = routeKey(source, target);
    const weight = drawn.has(key) ? 2 : 1;
    const current = laid.edge(source, target) as { weight?: number } | undefined;
    laid.setEdge(source, target, { weight: Math.max(weight, current?.weight ?? 0), minlen: 1 });
  }

  dagre.layout(laid);

  const positions = new Map<string, GraphPosition>();
  for (const item of principals) {
    const node = laid.node(item.id);
    const supports = supportsByParent.get(item.id) ?? [];
    const box = footprint(supports.length);
    const cx = typeof node?.x === "number" ? node.x : box.width / 2;
    const centerY = typeof node?.y === "number" ? node.y : box.height / 2;
    const cardX = cx - CARD_WIDTH / 2;
    const cardY = centerY - box.height / 2;
    positions.set(item.id, { x: cardX, y: cardY });

    supports.forEach((support, index) => {
      const x =
        cx -
        (supports.length * SUPPORT_SLOT) / 2 +
        index * SUPPORT_SLOT +
        (SUPPORT_SLOT - SUPPORT_SIZE) / 2;
      const y = cardY + CARD_HEIGHT + SUPPORT_GAP;
      positions.set(support.id, { x, y });
    });
  }

  const routes = new Map<string, GraphPosition[]>();
  for (const key of drawn) {
    const [source, target] = key.split("→");
    if (!source || !target) continue;
    const points = (laid.edge(source, target) as { points?: GraphPosition[] } | undefined)?.points ?? [];
    const inner = points.slice(1, -1).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    routes.set(key, inner.map((point) => ({ x: point.x, y: point.y })));
  }

  return { positions, routes };
}

export interface SubsystemBox {
  id: string;
  label: string;
  color: GroupColor;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayeredLayout {
  /** Posiciones absolutas (esquina superior izquierda) de tarjetas y sub-nodos. */
  positions: Map<string, GraphPosition>;
  boxes: SubsystemBox[];
  /** Capas de cada fila del lienzo, en orden de lectura (izquierda→derecha, arriba→abajo). */
  folds: number[][];
}

export const LAYERED = {
  /** Entre capas (180–220): canal para el cable y su etiqueta sin chocar con la columna vecina. */
  columnGap: 200,
  /** Entre tarjetas vecinas de una misma capa (70–90). */
  laneGap: 80,
  rowGap: 80,
  bandGap: 56,
  foldGap: 112,
  boxPadX: 32,
  boxPadTop: 52,
  boxPadBottom: 32,
  refinePasses: 3,
  /** Relación ancho/alto a la que se acerca el lienzo para que `fitView` muestre tarjetas legibles. */
  targetAspect: 16 / 10,
  maxLanes: 6,
} as const;

interface Band {
  key: string;
  subsystem: ModuleSubsystem | null;
  ids: string[];
  lo: number;
  hi: number;
}

interface Slot {
  width: number;
  height: number;
}

interface Packed {
  positions: Map<string, GraphPosition>;
  boxes: SubsystemBox[];
  width: number;
  height: number;
}

/**
 * Layout por capas fijas (columna = `layerOf`) en lugar de dejar que dagre decida el rango:
 * así el flujo siempre avanza Entrada → Orquestación → Servicios.
 *
 * Cada subsistema es una "banda" rectangular que ocupa sus columnas de extremo a extremo;
 * los módulos sueltos son bandas de una sola tarjeta. Las bandas se apilan con un skyline
 * por columna, de modo que una caja nunca se solapa con tarjetas ajenas, y su orden vertical
 * se refina por baricentro de vecinos para reducir cruces.
 *
 * Para acercarse a `targetAspect`: si el lienzo sale demasiado alto, cada columna reparte sus
 * tarjetas en varios carriles (rejilla); si sale demasiado ancho, las columnas se pliegan en
 * varias filas, cortando solo entre capas que ninguna caja atraviesa.
 */
export function layoutLayered(prepared: PreparedGraph): LayeredLayout {
  const { graph, layerOf, subsystemOf } = prepared;
  const principals = graph.modules.filter((item) => item.supportOf === undefined);
  const supportsByParent = new Map<string, CodeModule[]>();
  for (const item of graph.modules) {
    if (item.supportOf === undefined) continue;
    const list = supportsByParent.get(item.supportOf);
    if (list) list.push(item);
    else supportsByParent.set(item.supportOf, [item]);
  }
  const slotOf = (id: string) => footprint(supportsByParent.get(id)?.length ?? 0);
  const cellWidth = Math.max(CARD_WIDTH, ...principals.map((item) => slotOf(item.id).width));
  const layer = (id: string) => layerOf.get(id) ?? 0;
  const rankById = new Map(principals.map((item) => [item.id, intraSubsystemRank(item)]));
  const rank = (id: string) => rankById.get(id) ?? 0;

  const catalog = new Map(prepared.subsystems.map((item) => [item.id, item]));
  const bands: Band[] = [];
  const bandBySubsystem = new Map<string, Band>();
  for (const item of principals) {
    const subsystemId = subsystemOf.get(item.id);
    const subsystem = subsystemId ? catalog.get(subsystemId) : undefined;
    const existing = subsystem ? bandBySubsystem.get(subsystem.id) : undefined;
    if (existing) {
      existing.ids.push(item.id);
      existing.lo = Math.min(existing.lo, layer(item.id));
      existing.hi = Math.max(existing.hi, layer(item.id));
      continue;
    }
    const band: Band = { key: subsystem?.id ?? item.id, subsystem: subsystem ?? null, ids: [item.id], lo: layer(item.id), hi: layer(item.id) };
    bands.push(band);
    if (subsystem) bandBySubsystem.set(subsystem.id, band);
  }

  // Solo las capas con tarjetas ocupan columna: una capa vacía no deja hueco.
  const columns = [...new Set(principals.map((item) => layer(item.id)))].sort((left, right) => left - right);

  const ownerOf = new Map(graph.modules.map((item) => [item.id, item.supportOf ?? item.id]));
  const bandOf = new Map<string, Band>();
  for (const band of bands) for (const id of band.ids) bandOf.set(id, band);
  settleUnranked(
    rankById,
    graph.edges.flatMap((edge) => {
      const source = ownerOf.get(edge.source);
      const target = ownerOf.get(edge.target);
      const band = source ? bandOf.get(source) : undefined;
      return source && target && source !== target && band?.subsystem && bandOf.get(target) === band ? [[source, target] as const] : [];
    }),
  );
  const neighbours = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const source = ownerOf.get(edge.source);
    const target = ownerOf.get(edge.target);
    if (!source || !target || source === target) continue;
    neighbours.set(source, [...(neighbours.get(source) ?? []), target]);
    neighbours.set(target, [...(neighbours.get(target) ?? []), source]);
  }
  // Grado = aristas de entrada + salida del módulo principal (las de sus sub-nodos cuentan para él).
  const degreeOf = (id: string) => neighbours.get(id)?.length ?? 0;
  const bandDegree = (band: Band) => Math.max(...band.ids.map(degreeOf));

  const lanes = new Map(columns.map((column) => [column, 1]));
  const pack = (order: readonly Band[], cols: readonly number[]) =>
    packBands(order, cols, lanes, slotOf, layer, rank, cellWidth);

  // Carriles: si una sola fila de columnas ya sale más alta que ancha, cada capa se reparte en rejilla.
  const natural = pack(bands, columns);
  if (natural.height * LAYERED.targetAspect > natural.width) {
    const wanted = Math.round(Math.sqrt((LAYERED.targetAspect * natural.height) / Math.max(1, natural.width)));
    const k = Math.min(LAYERED.maxLanes, Math.max(1, wanted));
    for (const column of columns) {
      const lone = bands.filter((band) => band.subsystem === null && band.lo === column).length;
      const tallest = Math.max(lone, ...bands.map((band) => band.ids.filter((id) => layer(id) === column).length));
      lanes.set(column, Math.min(k, Math.max(1, tallest)));
    }
  }

  let order = [...bands].sort((left, right) => left.lo - right.lo);
  let packed = pack(order, columns);
  for (let pass = 0; pass < LAYERED.refinePasses; pass += 1) {
    const centerY = (id: string) => (packed.positions.get(id)?.y ?? 0) + slotOf(id).height / 2;
    const score = new Map<Band, number>();
    for (const band of order) {
      const outside = band.ids.flatMap((id) => neighbours.get(id) ?? []).filter((id) => bandOf.get(id) !== band);
      const own = band.ids.reduce((sum, id) => sum + centerY(id), 0) / band.ids.length;
      score.set(band, outside.length > 0 ? outside.reduce((sum, id) => sum + centerY(id), 0) / outside.length : own);
    }
    order = [...order].sort((left, right) => (score.get(left) ?? 0) - (score.get(right) ?? 0) || left.lo - right.lo);
    packed = pack(order, columns);
  }
  // El hub de cada columna (p. ej. RAG Pipeline) va al centro de su pila, no al final del skyline.
  order = centerHubs(order, (band) => band.lo, bandDegree);
  // Un par de tarjetas sueltas (Agent Loop + Conversation Memory) va con el hub arriba y el satélite debajo.
  order = hubFirstInPairs(order, (band) => band.lo, bandDegree, (band) => band.subsystem === null && band.ids.length === 1);

  // Pliegue en filas: cada fila se empaqueta por separado y se apila bajo la anterior.
  const packSegment = (segment: readonly number[]) => pack(order.filter((band) => segment.includes(band.lo)), segment);
  const folds = chooseFolds(columns, bands, packSegment);
  const merged: Packed = { positions: new Map(), boxes: [], width: 0, height: 0 };
  for (const segment of folds) {
    const part = packSegment(segment);
    const offsetY = merged.height === 0 ? 0 : merged.height + LAYERED.foldGap;
    for (const [id, slot] of part.positions) merged.positions.set(id, { x: slot.x, y: slot.y + offsetY });
    for (const box of part.boxes) merged.boxes.push({ ...box, y: box.y + offsetY });
    merged.width = Math.max(merged.width, part.width);
    merged.height = offsetY + part.height;
  }

  const positions = new Map<string, GraphPosition>();
  for (const [id, slot] of merged.positions) {
    const supports = supportsByParent.get(id) ?? [];
    const cx = slot.x + cellWidth / 2;
    const cardY = slot.y;
    positions.set(id, { x: cx - CARD_WIDTH / 2, y: cardY });
    supports.forEach((support, index) => {
      const x = cx - (supports.length * SUPPORT_SLOT) / 2 + index * SUPPORT_SLOT + (SUPPORT_SLOT - SUPPORT_SIZE) / 2;
      positions.set(support.id, { x, y: cardY + CARD_HEIGHT + SUPPORT_GAP });
    });
  }
  return { positions, boxes: merged.boxes, folds };
}

/**
 * Un módulo sin rango semántico dentro de una caja (`UNRANKED`) se coloca según sus aristas internas:
 * justo antes de su primer destino o justo después de su último origen. Así un "Tool Registry" que
 * despacha a Web Search y Page Fetcher queda arriba y los cables bajan, en vez de subir por fuera de la caja.
 */
export function settleUnranked(ranks: Map<string, number>, edges: ReadonlyArray<readonly [string, string]>): void {
  const known = (id: string) => {
    const value = ranks.get(id);
    return value !== undefined && value !== UNRANKED ? value : undefined;
  };
  const settled = new Map<string, number>();
  for (const [id, value] of ranks) {
    if (value !== UNRANKED) continue;
    const after = edges.flatMap(([from, to]) => (from === id ? [known(to)] : [])).filter((item): item is number => item !== undefined);
    const before = edges.flatMap(([from, to]) => (to === id ? [known(from)] : [])).filter((item): item is number => item !== undefined);
    if (after.length > 0) settled.set(id, Math.min(...after) - 0.5);
    else if (before.length > 0) settled.set(id, Math.max(...before) + 0.5);
  }
  for (const [id, value] of settled) ranks.set(id, value);
}

/**
 * Dentro de cada columna (bandas con el mismo `columnOf`), mueve la de mayor grado al índice
 * medio de esa columna. Las demás conservan su orden relativo y las posiciones que ocupa cada
 * columna en el orden global no cambian. Con menos de 3 bandas o sin aristas no hay nada que centrar.
 */
export function centerHubs<T>(order: readonly T[], columnOf: (item: T) => number, degreeOf: (item: T) => number): T[] {
  return reorderColumns(order, columnOf, (items) => {
    let hub = -1;
    let best = 0;
    items.forEach((item, index) => {
      const degree = degreeOf(item);
      if (degree > best) {
        best = degree;
        hub = index;
      }
    });
    if (items.length < 3 || hub < 0) return items;
    const rest = items.filter((_, index) => index !== hub);
    rest.splice(Math.floor(items.length / 2), 0, items[hub] as T);
    return rest;
  });
}

/**
 * En las columnas con exactamente dos elementos (todos `eligible`), pone primero el de mayor grado:
 * el hub arriba y su satélite debajo, en lugar de dejar que el baricentro lo suba por encima del hub.
 * Empates y el resto de columnas conservan su orden.
 */
export function hubFirstInPairs<T>(
  order: readonly T[],
  columnOf: (item: T) => number,
  degreeOf: (item: T) => number,
  eligible: (item: T) => boolean,
): T[] {
  return reorderColumns(order, columnOf, (items) => {
    const [first, second] = items;
    if (items.length !== 2 || first === undefined || second === undefined) return items;
    if (!eligible(first) || !eligible(second)) return items;
    return degreeOf(second) > degreeOf(first) ? [second, first] : items;
  });
}

/** Reordena los elementos de cada columna sin cambiar qué posiciones del orden global ocupa cada columna. */
function reorderColumns<T>(order: readonly T[], columnOf: (item: T) => number, arrange: (items: T[]) => T[]): T[] {
  const groups = new Map<number, T[]>();
  for (const item of order) {
    const column = columnOf(item);
    groups.set(column, [...(groups.get(column) ?? []), item]);
  }
  const arranged = new Map([...groups].map(([column, items]) => [column, arrange(items)]));
  const cursor = new Map<number, number>();
  return order.map((item) => {
    const column = columnOf(item);
    const index = cursor.get(column) ?? 0;
    cursor.set(column, index + 1);
    return (arranged.get(column) as T[])[index] as T;
  });
}

/**
 * Prueba de 1 a N filas, repartiendo las columnas con anchos equilibrados y cortando solo
 * donde ninguna caja cruza; se queda con la que más se acerca a `targetAspect`.
 */
function chooseFolds(
  columns: readonly number[],
  bands: readonly Band[],
  measure: (segment: readonly number[]) => Packed,
): number[][] {
  if (columns.length <= 1) return [[...columns]];
  const canBreakAfter = (column: number) => !bands.some((band) => band.lo <= column && band.hi > column);
  const whole = measure(columns);

  let best: { folds: number[][]; score: number } | null = null;
  for (let rows = 1; rows <= columns.length; rows += 1) {
    const target = whole.width / rows;
    const folds: number[][] = [[]];
    for (const [index, column] of columns.entries()) {
      const current = folds[folds.length - 1] as number[];
      current.push(column);
      const last = index === columns.length - 1;
      if (!last && folds.length < rows && measure(current).width >= target * 0.9 && canBreakAfter(column)) {
        folds.push([]);
      }
    }
    let width = 0;
    let height = 0;
    for (const segment of folds) {
      const part = measure(segment);
      width = Math.max(width, part.width);
      height += part.height;
    }
    height += LAYERED.foldGap * (folds.length - 1);
    const score = Math.abs(Math.log(width / Math.max(1, height)) - Math.log(LAYERED.targetAspect));
    if (!best || score < best.score - 1e-6) best = { folds, score };
  }
  return best?.folds ?? [[...columns]];
}

/**
 * Apila las bandas sobre las columnas indicadas. Cada columna tiene `lanes` carriles: las tarjetas
 * de una misma banda y capa se colocan en rejilla, centrada en la columna. Una caja de subsistema
 * que ocupa una sola columna no usa rejilla: apila sus tarjetas de arriba abajo por `rank`
 * (Chunker → Embedder → Vector Store), así el flujo interno se lee en vertical.
 */
function packBands(
  order: readonly Band[],
  columns: readonly number[],
  lanes: ReadonlyMap<number, number>,
  slotOf: (id: string) => Slot,
  layer: (id: string) => number,
  rank: (id: string) => number,
  cellWidth: number,
): Packed {
  const laneCount = (column: number) => lanes.get(column) ?? 1;
  const widthOf = (count: number) => count * cellWidth + (count - 1) * LAYERED.laneGap;
  const x0 = new Map<number, number>();
  let cursor = 0;
  for (const column of columns) {
    x0.set(column, cursor);
    cursor += widthOf(laneCount(column)) + LAYERED.columnGap;
  }

  const skyline = new Map<number, number>();
  const positions = new Map<string, GraphPosition>();
  const boxes: SubsystemBox[] = [];
  let height = 0;
  // Fila abierta de tarjetas sueltas por columna: las siguientes sueltas la rellenan carril a carril.
  const loose = new Map<number, { y: number; used: number; height: number }>();
  const boxed = new Set<number>();
  const looseIds = new Map<number, string[]>();

  for (const band of order) {
    const span = columns.filter((column) => column >= band.lo && column <= band.hi);
    const first = span[0];
    const last = span[span.length - 1];
    if (first === undefined || last === undefined) continue;

    const lone = band.subsystem === null && band.ids.length === 1 ? band.ids[0] : undefined;
    if (lone !== undefined) {
      const slot = slotOf(lone);
      const open = loose.get(first);
      if (open && open.used < laneCount(first) && skyline.get(first) === open.y + open.height + LAYERED.bandGap) {
        positions.set(lone, { x: (x0.get(first) ?? 0) + open.used * (cellWidth + LAYERED.laneGap), y: open.y });
        open.used += 1;
        open.height = Math.max(open.height, slot.height);
      } else {
        const y = skyline.get(first) ?? 0;
        positions.set(lone, { x: x0.get(first) ?? 0, y });
        loose.set(first, { y, used: 1, height: slot.height });
      }
      looseIds.set(first, [...(looseIds.get(first) ?? []), lone]);
      const row = loose.get(first) as { y: number; height: number };
      height = Math.max(height, row.y + row.height);
      skyline.set(first, row.y + row.height + LAYERED.bandGap);
      continue;
    }
    const padTop = band.subsystem ? LAYERED.boxPadTop : 0;
    const padBottom = band.subsystem ? LAYERED.boxPadBottom : 0;
    let top = 0;
    for (const column of span) top = Math.max(top, skyline.get(column) ?? 0);

    const stacked = band.subsystem !== null && band.lo === band.hi;
    const grids = new Map<number, string[][]>();
    if (stacked) {
      // Relleno por columnas: se lee de arriba abajo y, si hay varios carriles, continúa en el siguiente.
      const ids = [...band.ids].sort((left, right) => rank(left) - rank(right));
      const depth = Math.ceil(ids.length / Math.min(laneCount(first), ids.length));
      const rows: string[][] = [];
      ids.forEach((id, index) => {
        const row = index % depth;
        rows[row] = [...(rows[row] ?? []), id];
      });
      grids.set(first, rows);
    } else {
      for (const id of band.ids) {
        const column = layer(id);
        const rows = grids.get(column) ?? [];
        const tail = rows[rows.length - 1];
        if (tail && tail.length < laneCount(column)) tail.push(id);
        else rows.push([id]);
        grids.set(column, rows);
      }
    }
    const rowHeight = (row: readonly string[]) => Math.max(...row.map((id) => slotOf(id).height));
    const gridHeight = (rows: readonly string[][]) =>
      rows.reduce((sum, row) => sum + rowHeight(row), 0) + LAYERED.rowGap * Math.max(0, rows.length - 1);
    const content = Math.max(...[...grids.values()].map(gridHeight));

    for (const [column, rows] of grids) {
      let y = top + padTop + (content - gridHeight(rows)) / 2;
      const gridLanes = Math.max(...rows.map((row) => row.length));
      for (const row of rows) {
        const used = stacked ? gridLanes : row.length;
        const left = (x0.get(column) ?? 0) + (widthOf(laneCount(column)) - widthOf(used)) / 2;
        row.forEach((id, lane) => positions.set(id, { x: left + lane * (cellWidth + LAYERED.laneGap), y }));
        y += rowHeight(row) + LAYERED.rowGap;
      }
    }

    const bottom = top + padTop + content + padBottom;
    height = Math.max(height, bottom);
    for (const column of span) skyline.set(column, bottom + LAYERED.bandGap);
    if (band.subsystem) {
      for (const column of span) boxed.add(column);
      const x = (x0.get(first) ?? 0) - LAYERED.boxPadX;
      boxes.push({
        ...band.subsystem,
        x,
        y: top,
        width: (x0.get(last) ?? 0) + widthOf(laneCount(last)) + LAYERED.boxPadX - x,
        height: bottom - top,
      });
    }
  }
  // Una columna solo de tarjetas sueltas (p. ej. el orquestador) se centra en vertical frente a las
  // cajas vecinas en lugar de quedarse pegada arriba: así el hub queda a media altura de los servicios.
  for (const [column, ids] of looseIds) {
    if (boxed.has(column)) continue;
    const bottom = (skyline.get(column) ?? LAYERED.bandGap) - LAYERED.bandGap;
    const shift = Math.max(0, (height - bottom) / 2);
    for (const id of ids) {
      const position = positions.get(id);
      if (position) positions.set(id, { x: position.x, y: position.y + shift });
    }
  }
  return { positions, boxes, width: Math.max(0, cursor - LAYERED.columnGap), height };
}
