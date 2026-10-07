import { create } from "zustand";
import type { CodeGraph, CodeSubBlock, SubBlockKind } from "@core/graph";
import { buildIndexes, type GraphIndexes } from "./lib/graph";
import type { CodeTarget } from "./lib/editorLink";
import { matchModules, type MatchResult } from "./lib/search";

export type AppView = "architecture" | "history";
export type DrawerTab = "code" | "lesson" | "impact" | "flow";
/** Popovers de la barra lateral del lienzo: catálogo de módulos, filtros y conexión con el IDE. */
export type PopoverId = "components" | "ide" | "architecture" | "diff" | "health" | "check";
/** Lo que tiene el ratón encima en el lienzo: resalta sus cables y atenúa el resto. */
export type CanvasHover = { kind: "module" | "edge"; id: string } | null;
export interface LayoutStats {
  ms: number;
  modules: number;
  blocks: number;
}

interface CanvasState {
  selectedModuleId: string | null;
  selectedSubBlockId: string | null;
  query: string;
  focusEditor: boolean;
  groupFilter: ReadonlySet<string>;
  kindFilter: ReadonlySet<SubBlockKind>;
  match: MatchResult | null;
  followIde: boolean;
  activeSubBlockId: string | null;
  activeModuleId: string | null;
  graph: CodeGraph | null;
  indexes: GraphIndexes | null;
  view: AppView;
  drawer: { open: boolean; tab: DrawerTab; moduleId: string | null };
  popover: PopoverId | null;
  lessonFocusIds: ReadonlySet<string>;
  layoutStats: LayoutStats | null;
  /** Archivo y línea que la app mandó abrir por última vez (footer y deep link). */
  codeTarget: CodeTarget | null;
  impactAnalysisMode: boolean;
  /** Modo presentación: sin paneles ni barras de edición, tipografía grande y foco en el nodo seleccionado. */
  presentation: boolean;
  /**
   * Zoom semántico: 0 = bloques de arquitectura, 1 = módulos. Es lo que pide el usuario; el lienzo puede
   * saltarse Level 0 igualmente (grafo pequeño, demo, componentes añadidos). Ver `lib/level0.ts`.
   */
  archLevel: 0 | 1;
  /**
   * Resolución del zoom del viewport (0 = lejos, 2 = cerca): los nodos de Level 0 muestran más detalle al acercarse
   * (nombre → tecnología y nº de módulos → sus módulos clave). Ver `archResolutionFor`.
   */
  archResolution: 0 | 1 | 2;
  setArchResolution: (resolution: 0 | 1 | 2) => void;
  /** El lienzo enseña el mapa de sistema (Level 0 de servicios): «Probar en vivo» pide entrar en un servicio. */
  systemMapShown: boolean;
  setSystemMapShown: (shown: boolean) => void;
  /**
   * El grafo es un mapa de sistema (esqueleto de servicios del compose). El conmutador Sistema/Arquitectura solo
   * aparece entonces. En cualquier caso, `enterSubsystem(null)` vuelve al mapa: la vista «todos los módulos» no existe.
   */
  systemMode: boolean;
  setSystemMode: (systemMode: boolean) => void;
  /** Nivel superior del mapa de sistema: `system` = servicios; `architecture` = cada servicio abierto en sus abstracciones. */
  archView: "system" | "architecture";
  setArchView: (view: "system" | "architecture") => void;
  /** En un bloque del esqueleto: `false` = abstracciones (por defecto), `true` = sus archivos. */
  drillFiles: boolean;
  setDrillFiles: (drillFiles: boolean) => void;
  /** Bloque de Level 0 abierto en Level 1. `null` = mapa (nunca «todos los módulos»). */
  focusedSubsystemId: string | null;
  enterSubsystem: (blockId: string | null) => void;
  exitToLevel0: () => void;
  setPresentation: (presentation: boolean) => void;
  selectedImpactNodeId: string | null;
  /** Cable que el panel de impacto resalta al pasar el ratón por un módulo de su lista. */
  impactHoverEdgeId: string | null;
  setImpactHoverEdge: (edgeId: string | null) => void;
  hover: CanvasHover;
  setHover: (hover: CanvasHover) => void;
  /** Nodo que "Destacar en lienzo" hace resplandecer durante `SPOTLIGHT_MS`. */
  spotlightId: string | null;
  spotlight: (moduleId: string) => void;
  /** Módulos cuyo código acaba de cambiar en el IDE: se marcan unos segundos en el lienzo. */
  syncedIds: ReadonlySet<string>;
  markSynced: (moduleIds: readonly string[]) => void;
  setView: (view: AppView) => void;
  openDrawer: (moduleId: string | null, tab: DrawerTab) => void;
  closeDrawer: () => void;
  setDrawerTab: (tab: DrawerTab) => void;
  /** Abre (fuerza `view: "architecture"`) o cierra un popover de la barra lateral. */
  setPopover: (popover: PopoverId | null) => void;
  setLessonFocus: (ids: ReadonlySet<string>) => void;
  setLayoutStats: (stats: LayoutStats | null) => void;
  setCodeTarget: (target: CodeTarget | null) => void;
  deselect: () => void;
  selectSubBlock: (moduleId: string, subBlockId: string) => void;
  selectModule: (moduleId: string) => void;
  clearSelection: () => void;
  setQuery: (query: string) => void;
  toggleFocusEditor: () => void;
  setGraph: (graph: CodeGraph) => void;
  /** Reemplaza los sub-bloques de algunos módulos (código editado en el IDE) sin tocar la selección ni el panel. */
  patchModuleSubBlocks: (patches: ReadonlyMap<string, CodeSubBlock[]>) => void;
  /** Sustituye el grafo conservando selección, filtros y búsqueda (reconstrucción parcial desde el IDE). */
  applyGraphPatch: (graph: CodeGraph) => void;
  toggleGroup: (groupId: string) => void;
  toggleKind: (kind: SubBlockKind) => void;
  clearFilters: () => void;
  toggleFollowIde: () => void;
  setIdeLocation: (moduleId: string | null, subBlockId: string | null) => void;
  startImpact: (moduleId: string) => void;
  clearImpact: () => void;
}

/** Lo que dura el resplandor de "Destacar en lienzo" (dos pulsos de `.node-spotlight`). */
export const SPOTLIGHT_MS = 1800;
let spotlightTimer: ReturnType<typeof setTimeout> | null = null;
/** Lo que dura la marca "actualizado desde el IDE" en los nodos tocados. */
export const SYNCED_MS = 4000;
let syncedTimer: ReturnType<typeof setTimeout> | null = null;

function toggleMember<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function refreshMatch(
  indexes: GraphIndexes | null,
  query: string,
  groups: ReadonlySet<string>,
  kinds: ReadonlySet<SubBlockKind>,
): MatchResult | null {
  if (!indexes) return null;
  return matchModules(indexes, { query, groups, kinds });
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedModuleId: null,
  selectedSubBlockId: null,
  query: "",
  focusEditor: false,
  groupFilter: new Set<string>(),
  kindFilter: new Set<SubBlockKind>(),
  match: null,
  followIde: false,
  activeSubBlockId: null,
  activeModuleId: null,
  graph: null,
  indexes: null,
  view: "architecture",
  drawer: { open: false, tab: "code", moduleId: null },
  popover: null,
  lessonFocusIds: new Set<string>(),
  layoutStats: null,
  codeTarget: null,
  impactAnalysisMode: false,
  presentation: false,
  archLevel: 0,
  archResolution: 1,
  setArchResolution: (resolution) => set((state) => (state.archResolution === resolution ? state : { archResolution: resolution })),
  systemMapShown: false,
  setSystemMapShown: (shown) => set((state) => (state.systemMapShown === shown ? state : { systemMapShown: shown })),
  systemMode: false,
  setSystemMode: (systemMode) =>
    set((state) => {
      if (state.systemMode === systemMode) return state;
      // Si se estaba en L1 sin bloque (hairball legado), volver al mapa al detectar sistema.
      const leaveAll = systemMode && state.archLevel === 1 && state.focusedSubsystemId === null;
      return leaveAll ? { systemMode, archLevel: 0 as const, focusedSubsystemId: null } : { systemMode };
    }),
  archView: "system",
  setArchView: (archView) =>
    set((state) => (state.archView === archView && state.archLevel === 0 ? state : { archView, archLevel: 0, focusedSubsystemId: null, hover: null, drillFiles: false })),
  drillFiles: false,
  setDrillFiles: (drillFiles) => set({ drillFiles }),
  focusedSubsystemId: null,
  enterSubsystem: (blockId) =>
    set((state) => {
      // P0: `null` = volver al mapa. Nunca dibujar cientos de archivos a la vez.
      if (blockId === null) {
        return state.archLevel === 0 && state.focusedSubsystemId === null
          ? state
          : { archLevel: 0, focusedSubsystemId: null, hover: null, drillFiles: false, archView: "system" as const };
      }
      return state.archLevel === 1 && state.focusedSubsystemId === blockId ? state : { archLevel: 1, focusedSubsystemId: blockId, hover: null, drillFiles: false };
    }),
  exitToLevel0: () =>
    set({ archLevel: 0, focusedSubsystemId: null, hover: null, selectedModuleId: null, selectedSubBlockId: null, drillFiles: false, archView: "system" }),
  setPresentation: (presentation) => set((state) => (state.presentation === presentation ? state : { presentation, popover: null })),
  selectedImpactNodeId: null,
  impactHoverEdgeId: null,
  setImpactHoverEdge: (edgeId) => set((state) => (state.impactHoverEdgeId === edgeId ? state : { impactHoverEdgeId: edgeId })),
  hover: null,
  setHover: (hover) =>
    set((state) => (state.hover?.kind === hover?.kind && state.hover?.id === hover?.id ? state : { hover })),
  spotlightId: null,
  spotlight: (moduleId) => {
    if (spotlightTimer) clearTimeout(spotlightTimer);
    // Pasar por null reinicia la animación si se destaca el mismo nodo dos veces seguidas.
    set({ spotlightId: null });
    requestAnimationFrame(() => set({ spotlightId: moduleId }));
    spotlightTimer = setTimeout(() => {
      spotlightTimer = null;
      set({ spotlightId: null });
    }, SPOTLIGHT_MS);
  },
  syncedIds: new Set<string>(),
  markSynced: (moduleIds) => {
    if (moduleIds.length === 0) return;
    if (syncedTimer) clearTimeout(syncedTimer);
    set({ syncedIds: new Set(moduleIds) });
    syncedTimer = setTimeout(() => {
      syncedTimer = null;
      set({ syncedIds: new Set<string>() });
    }, SYNCED_MS);
  },
  setView: (view) => set({ view }),
  openDrawer: (moduleId, tab) =>
    set((state) => ({
      drawer: { open: true, tab, moduleId: moduleId ?? state.drawer.moduleId },
      ...(moduleId !== null
        ? { selectedModuleId: moduleId, selectedSubBlockId: null }
        : {}),
    })),
  closeDrawer: () => set((state) => ({ drawer: { ...state.drawer, open: false } })),
  setDrawerTab: (tab) => set((state) => ({ drawer: { ...state.drawer, tab } })),
  // Historial y popovers son excluyentes: abrir un popover vuelve al lienzo de arquitectura; cerrarlo no toca la vista.
  setPopover: (popover) => set(popover === null ? { popover } : { popover, view: "architecture" }),
  setLessonFocus: (lessonFocusIds) => set({ lessonFocusIds }),
  setLayoutStats: (layoutStats) => set({ layoutStats }),
  setCodeTarget: (codeTarget) => set({ codeTarget }),
  deselect: () => set({ selectedModuleId: null, selectedSubBlockId: null }),
  selectSubBlock: (moduleId, subBlockId) =>
    set({ selectedModuleId: moduleId, selectedSubBlockId: subBlockId }),
  selectModule: (moduleId) => set({ selectedModuleId: moduleId, selectedSubBlockId: null }),
  clearSelection: () => set({ selectedModuleId: null, selectedSubBlockId: null }),
  setQuery: (query) =>
    set((state) => ({
      query,
      match: refreshMatch(state.indexes, query, state.groupFilter, state.kindFilter),
    })),
  toggleFocusEditor: () => set((state) => ({ focusEditor: !state.focusEditor })),
  setGraph: (graph) =>
    set({
      graph,
      indexes: buildIndexes(graph),
      query: "",
      groupFilter: new Set<string>(),
      kindFilter: new Set<SubBlockKind>(),
      match: null,
      selectedModuleId: null,
      selectedSubBlockId: null,
      activeModuleId: null,
      activeSubBlockId: null,
      drawer: { open: false, tab: "code", moduleId: null },
      popover: null,
      lessonFocusIds: new Set<string>(),
      layoutStats: null,
      codeTarget: null,
      impactAnalysisMode: false,
      selectedImpactNodeId: null,
      impactHoverEdgeId: null,
      hover: null,
      spotlightId: null,
      archLevel: 0,
      focusedSubsystemId: null,
      archView: "system",
    }),
  patchModuleSubBlocks: (patches) =>
    set((state) => {
      if (!state.graph || patches.size === 0) return state;
      let touched = false;
      const modules = state.graph.modules.map((item) => {
        const subBlocks = patches.get(item.id);
        if (!subBlocks) return item;
        touched = true;
        return { ...item, subBlocks };
      });
      if (!touched) return state;
      const graph: CodeGraph = { ...state.graph, modules };
      const indexes = buildIndexes(graph);
      const selectedModule = state.selectedModuleId ? indexes.modulesById.get(state.selectedModuleId) : undefined;
      const selectionAlive = selectedModule?.subBlocks.some((block) => block.id === state.selectedSubBlockId) ?? false;
      return {
        graph,
        indexes,
        match: refreshMatch(indexes, state.query, state.groupFilter, state.kindFilter),
        selectedSubBlockId: selectionAlive ? state.selectedSubBlockId : null,
      };
    }),
  applyGraphPatch: (graph) =>
    set((state) => {
      if (!state.graph) return state;
      const indexes = buildIndexes(graph);
      const selectedModule = state.selectedModuleId ? indexes.modulesById.get(state.selectedModuleId) : undefined;
      const selectionAlive = selectedModule?.subBlocks.some((block) => block.id === state.selectedSubBlockId) ?? false;
      return {
        graph,
        indexes,
        match: refreshMatch(indexes, state.query, state.groupFilter, state.kindFilter),
        selectedModuleId: selectedModule ? state.selectedModuleId : null,
        selectedSubBlockId: selectionAlive ? state.selectedSubBlockId : null,
      };
    }),
  toggleGroup: (groupId) =>
    set((state) => {
      const groupFilter = toggleMember(state.groupFilter, groupId);
      return {
        groupFilter,
        match: refreshMatch(state.indexes, state.query, groupFilter, state.kindFilter),
      };
    }),
  toggleKind: (kind) =>
    set((state) => {
      const kindFilter = toggleMember(state.kindFilter, kind);
      return {
        kindFilter,
        match: refreshMatch(state.indexes, state.query, state.groupFilter, kindFilter),
      };
    }),
  clearFilters: () =>
    set({
      query: "",
      groupFilter: new Set<string>(),
      kindFilter: new Set<SubBlockKind>(),
      match: null,
    }),
  toggleFollowIde: () => set((state) => ({ followIde: !state.followIde })),
  setIdeLocation: (moduleId, subBlockId) =>
    set((state) => {
      if (state.activeModuleId === moduleId && state.activeSubBlockId === subBlockId) return state;
      return { activeModuleId: moduleId, activeSubBlockId: subBlockId };
    }),
  startImpact: (moduleId) =>
    set({
      impactAnalysisMode: true,
      selectedImpactNodeId: moduleId,
      impactHoverEdgeId: null,
      selectedModuleId: moduleId,
      selectedSubBlockId: null,
      drawer: { open: true, tab: "impact", moduleId },
    }),
  clearImpact: () => set({ impactAnalysisMode: false, selectedImpactNodeId: null, impactHoverEdgeId: null }),
}));
