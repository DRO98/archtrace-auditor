import type { LucideIcon } from "lucide-react";
import {
  Cable,
  Code2,
  MemoryStick,
  Radio,
  Waves,
  HardDrive,
  LayoutDashboard,
  MessageSquareText,
  Rocket,
  Scissors,
  Network,
  Server,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import type { GroupColor, ModuleRole } from "@core/graph";

export const CARD_WIDTH = 272;
export const CARD_HEIGHT = 80;
export const SUPPORT_SIZE = 56;
export const SUPPORT_SLOT = 96;
export const SUPPORT_GAP = 72;
export const SUPPORT_LABEL = 40;
export const MINIMAP_WIDTH = 150;
export const MINIMAP_HEIGHT = 96;

/** Margen por defecto de los `<Panel>` de React Flow respecto al borde del lienzo. */
export const PANEL_MARGIN = 15;
/** Alto de los controles de zoom, apilados sobre el minimapa. */
export const ZOOM_CONTROLS_HEIGHT = 42;
/** Encuadre inicial y del botón "Centrar vista": poco margen para que las tarjetas se lean grandes. */
export const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1 } as const;

/** Espacio que ocupa una tarjeta con `n` sub-nodos (es lo que se le da a dagre). */
export function footprint(n: number): { width: number; height: number } {
  if (n === 0) return { width: CARD_WIDTH, height: CARD_HEIGHT };
  return {
    width: Math.max(CARD_WIDTH, n * SUPPORT_SLOT),
    height: CARD_HEIGHT + SUPPORT_GAP + SUPPORT_SIZE + SUPPORT_LABEL,
  };
}

/** Posición horizontal (0–100 %) del asa-diamante del sub-nodo `i` de `n`, acotada a la tarjeta. */
export function supportHandlePercent(i: number, n: number): number {
  const offset = (i - (n - 1) / 2) * SUPPORT_SLOT;
  return Math.min(90, Math.max(10, 50 + (offset / CARD_WIDTH) * 100));
}

export const ROLE_ICON: Record<ModuleRole, LucideIcon> = {
  api: Network,
  pipeline: Workflow,
  database: HardDrive,
  cache: MemoryStick,
  broker: Radio,
  stream: Waves,
  rpc: Cable,
  "ai-model": Sparkles,
  transform: Scissors,
  prompt: MessageSquareText,
  app: Rocket,
  service: Server,
  ui: LayoutDashboard,
  util: Wrench,
  code: Code2,
};

/** Arranque de tipo configuración (config/settings/env): se dibuja con engranaje. */
export function isConfigModule(role: ModuleRole, filePath: string): boolean {
  return role === "app" && /(^|[/_.-])(config|settings|env)([/_.-]|$)/i.test(filePath);
}

export interface RoleTone {
  /** Contenedor del icono (fondo suave + color del trazo). */
  tile: string;
  /** Borde de la tarjeta. */
  border: string;
  /** Color sólido para el minimapa. */
  hex: string;
}

const TONE_GREEN: RoleTone = { tile: "bg-emerald-100 text-emerald-700", border: "border-emerald-200", hex: "#10b981" };
const TONE_BLUE: RoleTone = { tile: "bg-blue-100 text-blue-700", border: "border-blue-200", hex: "#3b82f6" };
const TONE_PURPLE: RoleTone = { tile: "bg-violet-100 text-violet-700", border: "border-violet-200", hex: "#8b5cf6" };
const TONE_ORANGE: RoleTone = { tile: "bg-orange-100 text-orange-700", border: "border-orange-200", hex: "#f97316" };
const TONE_ROSE: RoleTone = { tile: "bg-rose-100 text-rose-700", border: "border-rose-200", hex: "#f43f5e" };
const TONE_AMBER: RoleTone = { tile: "bg-amber-100 text-amber-700", border: "border-amber-200", hex: "#d97706" };
const TONE_CYAN: RoleTone = { tile: "bg-cyan-100 text-cyan-700", border: "border-cyan-200", hex: "#0891b2" };
const TONE_NEUTRAL: RoleTone = { tile: "bg-neutral-100 text-neutral-700", border: "border-line", hex: "#737373" };

/**
 * Cromática por categoría técnica: datos (BD, caché) verde, entrada (API, RPC) azul, orquestación púrpura,
 * mensajería/streaming ámbar y cian, IA naranja, arranque rosa.
 */
export const ROLE_TONE: Record<ModuleRole, RoleTone> = {
  database: TONE_GREEN,
  cache: TONE_GREEN,
  api: TONE_BLUE,
  rpc: TONE_BLUE,
  broker: TONE_AMBER,
  stream: TONE_CYAN,
  pipeline: TONE_PURPLE,
  transform: TONE_PURPLE,
  "ai-model": TONE_ORANGE,
  prompt: TONE_ORANGE,
  app: TONE_ROSE,
  service: TONE_NEUTRAL,
  ui: TONE_NEUTRAL,
  util: TONE_NEUTRAL,
  code: TONE_NEUTRAL,
};

/**
 * Estilo de las aristas. Cada cable hereda el color del nodo que lo emite (el mismo `hex` de su icono y
 * del minimapa); los roles neutros (servicio, utilidad…) toman el color de su subsistema o grupo.
 * La opacidad de trazo deja ver qué cable pasa por encima cuando dos se cruzan.
 */
export const EDGE_STYLE = {
  width: 2,
  focusWidth: 3,
  opacity: 0.8,
  /** Opacidad de los cables ajenos al nodo o cable resaltado. */
  dimmedOpacity: 0.15,
  cornerRadius: 12,
  neutral: "#a3a3a3",
} as const;

export function edgeColorFor(role: ModuleRole, fallbackHex?: string): string {
  const tone = ROLE_TONE[role];
  if (tone !== TONE_NEUTRAL) return tone.hex;
  return fallbackHex ?? EDGE_STYLE.neutral;
}

export const ROLE_LABEL: Record<ModuleRole, string> = {
  api: "API",
  pipeline: "Flujo",
  database: "Base de datos",
  cache: "Caché",
  broker: "Broker de mensajes",
  stream: "Procesado de streams",
  rpc: "RPC",
  "ai-model": "Modelo de IA",
  transform: "Transformación",
  prompt: "Prompt",
  app: "Aplicación",
  service: "Servicio",
  ui: "Interfaz",
  util: "Utilidad",
  code: "Código",
};

export interface GroupStyle {
  dot: string;
  chip: string;
  hex: string;
}

export const GROUP_STYLES: Record<GroupColor, GroupStyle> = {
  sky: { dot: "bg-sky-500", chip: "border-sky-200 bg-sky-50 text-sky-700", hex: "#0ea5e9" },
  emerald: { dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700", hex: "#10b981" },
  violet: { dot: "bg-violet-500", chip: "border-violet-200 bg-violet-50 text-violet-700", hex: "#8b5cf6" },
  amber: { dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700", hex: "#f59e0b" },
  rose: { dot: "bg-rose-500", chip: "border-rose-200 bg-rose-50 text-rose-700", hex: "#f43f5e" },
  zinc: { dot: "bg-neutral-500", chip: "border-neutral-200 bg-neutral-100 text-neutral-700", hex: "#737373" },
};

/**
 * Única columna lateral derecha (detalles del módulo o "Probar en vivo"): nunca hay dos a la vez.
 * Es hermana del lienzo en el flex, así que el lienzo se estrecha en vez de quedar tapado.
 */
export const RIGHT_PANEL_CLASS =
  "flex w-[480px] max-w-[50vw] min-w-[min(370px,100vw)] shrink-0 flex-col border-l border-line bg-white outline-none";

/** Botones de la cabecera: acción principal (violeta/índigo), secundaria (slate) y su variante "activa". */
const HEADER_BUTTON_BASE =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-all active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
export const HEADER_BUTTON_PRIMARY = `${HEADER_BUTTON_BASE} border border-transparent bg-gradient-to-r from-teal-600 to-teal-600 text-white shadow-sm hover:from-teal-500 hover:to-teal-500 hover:shadow-lg hover:shadow-teal-500/20`;
export const HEADER_BUTTON_SECONDARY = `${HEADER_BUTTON_BASE} border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 hover:shadow-md hover:shadow-slate-500/10`;
export const HEADER_BUTTON_ACTIVE = `${HEADER_BUTTON_BASE} border border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:shadow-md hover:shadow-teal-500/20`;

/** Cajas de texto y selectores: borde limpio y anillo violeta al enfocar. */
export const FIELD_CLASS =
  "w-full rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60";
