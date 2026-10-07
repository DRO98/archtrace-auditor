"use client";

import { create } from "zustand";
import { isModelName, isProviderId, type AiProviderId } from "@/lib/ai/catalog";
import { isArchitectureKind, type ArchitectureKind } from "../lib/architectureKind";
import {
  componentModuleId,
  isComponentTemplateId,
  removeComponent,
  spliceComponent,
  type AddedComponent,
  type CanvasPoint,
  type ComponentTemplateId,
} from "./components";
import { addNote, removeNote, sanitizeNotes, type NodeNote, type NoteKind, type NotesByNode } from "./notes";

const STORAGE_KEY = "tc:canvas-edits:v1";

export interface LlmAssignment {
  provider: AiProviderId;
  model: string;
}

/**
 * Estado de proyecto de un pipeline (guardado por nombre de grafo): componentes añadidos, modelo del nodo
 * LLM, notas de arquitectura por nodo y el tipo de arquitectura elegido a mano (null = detectado).
 */
export interface GraphEdits {
  components: AddedComponent[];
  llm: LlmAssignment | null;
  notes: NotesByNode;
  architectureKind: ArchitectureKind | null;
}

export interface NodeMenu {
  nodeId: string;
  x: number;
  y: number;
}

interface CanvasEditsState extends GraphEdits {
  graphName: string | null;
  menu: NodeMenu | null;
  /** Carga las ediciones guardadas de `graphName` (y descarta las del grafo anterior). */
  load: (graphName: string) => void;
  /**
   * Añade `template`: empalmado antes de `before` o, con `placement.detached`, suelto (sin aristas) en
   * `placement.position`. Devuelve el id del nodo nuevo.
   */
  add: (template: ComponentTemplateId, before: string | null, placement?: ComponentPlacement) => string;
  /** «Empalmar en el flujo»: conecta un componente suelto antes de su nodo sugerido (o de `target`). */
  splice: (moduleId: string, target?: string | null) => void;
  remove: (moduleId: string) => void;
  setLlm: (llm: LlmAssignment | null) => void;
  addNote: (nodeId: string, text: string, kind: NoteKind) => NodeNote | null;
  removeNote: (nodeId: string, noteId: string) => void;
  setArchitectureKind: (kind: ArchitectureKind | null) => void;
  openMenu: (menu: NodeMenu) => void;
  closeMenu: () => void;
}

export interface ComponentPlacement {
  detached: boolean;
  position?: CanvasPoint;
}

type Stored = Record<string, GraphEdits>;
const EMPTY: GraphEdits = { components: [], llm: null, notes: {}, architectureKind: null };

function readAll(): Stored {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function isPoint(value: unknown): value is CanvasPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isFinite((value as CanvasPoint).x) &&
    Number.isFinite((value as CanvasPoint).y)
  );
}

/** Normaliza un componente guardado; los antiguos (sin `detached`) siguen empalmados como antes. */
function sanitizeComponent(item: AddedComponent): AddedComponent {
  const clean: AddedComponent = { id: item.id, template: item.template, before: item.before };
  if (item.detached === true) {
    clean.detached = true;
    if (isPoint(item.position)) clean.position = { x: item.position.x, y: item.position.y };
  }
  return clean;
}

function sanitize(value: unknown): GraphEdits {
  if (typeof value !== "object" || value === null) return EMPTY;
  const record = value as Record<string, unknown>;
  const components = Array.isArray(record.components)
    ? record.components.filter(
        (item): item is AddedComponent =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as AddedComponent).id === "string" &&
          isComponentTemplateId((item as AddedComponent).template) &&
          ((item as AddedComponent).before === null || typeof (item as AddedComponent).before === "string"),
      ).map(sanitizeComponent)
    : [];
  const llm = record.llm as Partial<LlmAssignment> | null | undefined;
  const validLlm = llm && isProviderId(llm.provider) && isModelName(llm.model) ? { provider: llm.provider, model: llm.model } : null;
  return {
    components,
    llm: validLlm,
    notes: sanitizeNotes(record.notes),
    architectureKind: isArchitectureKind(record.architectureKind) ? record.architectureKind : null,
  };
}

function isEmpty(edits: GraphEdits): boolean {
  return edits.components.length === 0 && edits.llm === null && Object.keys(edits.notes).length === 0 && edits.architectureKind === null;
}

function persist(graphName: string | null, edits: GraphEdits): void {
  if (!graphName) return;
  try {
    const all = readAll();
    if (isEmpty(edits)) delete all[graphName];
    else all[graphName] = edits;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Almacenamiento bloqueado: las ediciones duran lo que la pestaña.
  }
}

function snapshot(state: GraphEdits): GraphEdits {
  return { components: state.components, llm: state.llm, notes: state.notes, architectureKind: state.architectureKind };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

/** Capa de edición del lienzo, guardada por pipeline en `localStorage`. */
export const useCanvasEdits = create<CanvasEditsState>((set, get) => ({
  ...EMPTY,
  graphName: null,
  menu: null,
  load: (graphName) => {
    if (get().graphName === graphName) return;
    set({ graphName, menu: null, ...sanitize(readAll()[graphName]) });
  },
  add: (template, before, placement) => {
    const component: AddedComponent = { id: newId(), template, before };
    if (placement?.detached) {
      component.detached = true;
      if (placement.position) component.position = placement.position;
    }
    const components = [...get().components, component];
    set({ components });
    persist(get().graphName, { ...snapshot(get()), components });
    return componentModuleId(component.id);
  },
  splice: (moduleId, target) => {
    const components = spliceComponent(get().components, moduleId, target);
    set({ components, menu: null });
    persist(get().graphName, { ...snapshot(get()), components });
  },
  remove: (moduleId) => {
    const components = removeComponent(get().components, moduleId);
    set({ components, menu: null });
    persist(get().graphName, { ...snapshot(get()), components });
  },
  setLlm: (llm) => {
    set({ llm });
    persist(get().graphName, { ...snapshot(get()), llm });
  },
  addNote: (nodeId, text, kind) => {
    const result = addNote(get().notes, nodeId, { id: newId(), text, kind, createdAt: new Date().toISOString() });
    if (!result) return null;
    set({ notes: result.notes });
    persist(get().graphName, snapshot(get()));
    return result.note;
  },
  removeNote: (nodeId, noteId) => {
    set({ notes: removeNote(get().notes, nodeId, noteId) });
    persist(get().graphName, snapshot(get()));
  },
  setArchitectureKind: (architectureKind) => {
    set({ architectureKind });
    persist(get().graphName, snapshot(get()));
  },
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set((state) => (state.menu ? { menu: null } : state)),
}));
