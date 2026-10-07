# TICKET 7: Rediseño visual pro (light, estilo n8n) + Teacher Drawer

> **Este documento es un runbook para un agente (Cursor / Claude Code).**
> Léelo entero antes de tocar nada y luego ejecútalo **paso a paso, en orden**.

---

## 0. Cómo debes trabajar

1. **Orden estricto.** Haz los pasos 0 → 11 en orden. No empieces un paso hasta que el checkpoint del anterior esté en verde.
2. **Checkpoint = obligatorio.** Cada paso termina con comandos a ejecutar. Si fallan, arréglalos antes de seguir. Nunca dejes un paso "para luego".
3. **No amplíes el alcance.** No añadas dependencias, no toques archivos que el paso no menciona, no refactorices por gusto.
4. **Lee antes de escribir.** Antes de modificar un archivo existente, léelo entero. Los bloques de código de este documento son **referencia**: si no compilan con los tipos reales del repo, ajústalos manteniendo la intención visual y de comportamiento.
5. **Reglas del repo** (relee si dudas): `.cursorrules`, `CLAUDE.md`, `web/AGENTS.md`. En concreto:
   - TypeScript estricto. **Prohibido `any`.**
   - Nada de lógica WebSocket dentro de componentes de UI. Para enviar mensajes usa `sendTeacherMessage` de `@/hooks/useTeacherSocket`.
   - Antes de tocar `layout.tsx` o cualquier API de Next, lee lo relevante de `web/node_modules/next/dist/docs/`.
   - Los tipos compartidos van en `core/src/` y se importan con `import type`.
6. **No hay git en este repo.** Por eso el Paso 0 hace una copia de seguridad.
7. **Verificación visual.** Si tienes navegador integrado, úsalo. Si no, no inventes: en el informe final marca esos criterios como **"requiere verificación humana"**.
8. **Si te bloqueas de verdad** (algo del documento contradice el código real y no sabes cómo resolverlo), detente y pregunta con: *qué paso, qué esperabas, qué encontraste, qué opciones ves*.

### Comandos habituales

Todos desde `web/` salvo que se indique otra cosa:

```
npm run typecheck
npm run lint
npm test
npm run build
npm run graph:build
npm run graph:validate
```

Raíz del repo: `C:\Users\alexc\OneDrive\Documentos\TEACHER`.

---

## 1. Objetivo

Convertir `web/` en una interfaz clara y minimalista, inspirada en n8n.

- **Lienzo:** muestra solo la **arquitectura modular** (tarjetas de componentes, sub-nodos de apoyo con línea discontinua y sus conexiones). **Sin números de paso en ninguna tarjeta.**
- **Panel lateral (Teacher Drawer):** aloja la exploración del código de un componente y, más adelante (Ticket 6), la lección paso a paso 1 → 2 → 3.

### Decisiones ya tomadas (no las cuestiones)

- **Tema claro únicamente.** Los tokens son semánticos para poder añadir modo oscuro más adelante.
- **Las filas de sub-bloques salen de la tarjeta** y pasan a la pestaña "Código" del drawer. La navegación exacta a VS Code se conserva.
- **"Editor / Executions" → "Arquitectura / Lecciones".**
- **"Añadir nodo" → "Buscar módulo".** El grafo sale del código y no se edita a mano.
- **Botón primario oscuro** (negro con texto blanco). El coral `#ff6d5a` se usa solo para anillos de selección y foco (el texto blanco sobre coral no llega a contraste AA).
- **Sin fuentes remotas.** Stack de sistema.
- **Sin dependencias nuevas.** Ya están instaladas: `@xyflow/react` 12.12.0, `lucide-react` 1.48.0, `zustand`, `clsx`, `tailwind-merge`, Tailwind 4.3.3.
- **La referencia visual no está disponible para el equipo técnico.** Todos los colores, medidas y sombras van centralizados en `globals.css` y `theme.ts` para poder retocarlos en un solo sitio.

---

## 2. Estado de partida (ya verificado)

- Stack: Next 16.3.6, React 19.2.8, Tailwind 4 (sin `tailwind.config`; los tokens van en `@theme` dentro de `globals.css`).
- Los **nombres de iconos de Lucide** usados abajo existen en la versión instalada: `Code2`, `Database`, `LayoutDashboard`, `MessageSquareText`, `Rocket`, `Scissors`, `Server`, `Sparkles`, `Webhook`, `Workflow`, `Wrench`, `SlidersHorizontal`, `Settings`, `Maximize2`, `Minus`, `Plus`, `ChevronRight`, `GraduationCap`, `X`, `Eraser`, `Check`, `Search`, `SquareFunction`, `Box`, `Braces`, `Blocks`.
- Las **variables CSS de React Flow** existen con estos nombres: `--xy-background-color`, `--xy-edge-stroke`, `--xy-edge-stroke-selected`, `--xy-handle-background-color`, `--xy-handle-border-color`, `--xy-minimap-background-color`, `--xy-minimap-mask-background-color`, `--xy-controls-*`, `--xy-node-*`.
- Código actual del canvas, en `web/src/features/canvas/`:
  - `CanvasApp.tsx`, `CanvasView.tsx`, `IdeSyncBridge.tsx`, `store.ts`, `theme.ts`
  - `components/Toolbar.tsx`, `components/FilterBar.tsx`, `components/IdeDock.tsx`
  - `lib/flow.ts`, `lib/layout.ts`, `lib/graph.ts`, `lib/search.ts`, `lib/ideSync.ts` (+ sus `*.test.ts`)
  - `nodes/ModuleNode.tsx`, `nodes/SubBlockRow.tsx`, `nodes/nodeTypes.ts`
- Otros archivos afectados: `web/src/components/ConnectionBadge.tsx`, `web/src/components/BridgeTestPanel.tsx`, `web/src/app/{globals.css,layout.tsx,page.tsx,debug/page.tsx}`, `web/scripts/build-sandbox-graph.ts`, `core/src/graph.ts`, `web/public/graphs/macro_rag_project.json`.
- **El Ticket 6 aún no está implementado**: no existen `features/lesson`, `features/settings` ni `extension/src/scan`. No los crees aquí.
- Hoy `parseCodeGraph` (`lib/graph.ts`) reconstruye cada módulo campo a campo, así que descartaría en silencio cualquier campo nuevo. Hay que actualizarlo (Paso 1).

### Reglas de Tailwind 4 que debes respetar

- El modificador `!` (important) va **al final** de la clase: `size-2.5!`, `hover:bg-ink!`.
- Los tokens de `@theme` (`--color-canvas`, `--color-ink`, …) generan utilidades: `bg-canvas`, `text-ink`, `border-line`, `ring-accent`.
- Las clases deben aparecer **completas** en el código. Nunca construyas `` `bg-${color}-500` ``: usa mapas con strings literales.

---

## PASO 0. Preparación y línea base

**Hacer**
1. Copia de seguridad **fuera de `web/`** (para que `tsc` no la compile):
   ```powershell
   New-Item -ItemType Directory -Force C:\Users\alexc\OneDrive\Documentos\TEACHER\.backup\ticket7
   Copy-Item -Recurse -Force C:\Users\alexc\OneDrive\Documentos\TEACHER\web\src C:\Users\alexc\OneDrive\Documentos\TEACHER\.backup\ticket7\web-src
   Copy-Item -Recurse -Force C:\Users\alexc\OneDrive\Documentos\TEACHER\web\scripts C:\Users\alexc\OneDrive\Documentos\TEACHER\.backup\ticket7\web-scripts
   Copy-Item -Recurse -Force C:\Users\alexc\OneDrive\Documentos\TEACHER\web\public\graphs C:\Users\alexc\OneDrive\Documentos\TEACHER\.backup\ticket7\web-graphs
   Copy-Item -Force C:\Users\alexc\OneDrive\Documentos\TEACHER\core\src\graph.ts C:\Users\alexc\OneDrive\Documentos\TEACHER\.backup\ticket7\core-graph.ts
   ```
2. Añade `.backup` al `.gitignore` de la raíz.
3. Lee `web/AGENTS.md` y `.cursorrules`.
4. **Línea base:** ejecuta `npm run typecheck`, `npm run lint` y `npm test` en `web/` y anota el resultado. Si ya hay fallos, no son tuyos, pero apúntalos para el informe.

**Checkpoint:** la copia existe y tienes anotada la línea base.

---

## PASO 1. Modelo de datos: `role`, `subtitle`, `supportOf`

**Objetivo:** que el grafo pueda describir iconos, subtítulos y sub-nodos de apoyo.

### 1.1 `core/src/graph.ts` (solo tipos)

Añade el tipo `ModuleRole` y tres campos opcionales a `CodeModule`. El resto del archivo no cambia.

```ts
export type ModuleRole =
  | "api" | "pipeline" | "database" | "ai-model" | "transform"
  | "prompt" | "app" | "service" | "ui" | "util" | "code";

export interface CodeModule {
  // …campos actuales sin cambios…
  /** Título humano ("RAG Pipeline"), no el nombre de archivo. */
  label: string;
  role?: ModuleRole;
  /** Línea secundaria de la tarjeta ("ingest · retrieve · answer"). */
  subtitle?: string;
  /** Si existe, este módulo se dibuja como sub-nodo circular de ese módulo. */
  supportOf?: string;
}
```

### 1.2 `web/src/features/canvas/lib/graph.ts` → `parseModules`

- Añade un `Set` con los 11 roles válidos.
- Si `entry.role` existe: debe ser string del set; si no, `errors.push(\`${entry.id}: role inválido\`)`. Si es válido, guárdalo en `module.role`.
- Si `entry.subtitle` existe: debe ser string; guárdalo en `module.subtitle`.
- Si `entry.supportOf` existe: debe ser string; guárdalo en `module.supportOf`.
- **Validación cruzada** (después de construir todos los módulos, dentro de `parseCodeGraph` o al final de `parseModules`):
  - `supportOf` debe existir como id de módulo → error `"<id>: supportOf inexistente"`.
  - `supportOf` no puede ser el propio id → error `"<id>: supportOf apunta a sí mismo"`.
  - El módulo al que apunta no puede tener a su vez `supportOf` (sin cadenas) → error `"<id>: supportOf apunta a otro módulo de apoyo"`.

### 1.3 Tests: `lib/graph.test.ts`

Añade casos (lee primero cómo están montados los existentes y reutiliza sus helpers):
- Un grafo válido con `role`, `subtitle` y `supportOf` → `ok` y los campos **se conservan** en el resultado.
- `role: "banana"` → error.
- `supportOf` inexistente → error.
- `supportOf` igual al propio id → error.
- Cadena de apoyo (A apoya a B, B apoya a C) → error.

**Checkpoint:** en `web/`, `npm run typecheck` y `npm test` pasan. Desde la raíz, `npm run typecheck` también.

---

## PASO 2. Funciones puras de arquitectura

**Objetivo:** deducir rol, subtítulo y título humano cuando el grafo no los trae.

Crea `web/src/features/canvas/lib/architecture.ts`:

### `inferRole(module: CodeModule): ModuleRole`

1. Divide `module.filePath` en tokens: por `/`, `_`, `-`, `.` y por cambios camelCase; todo en minúsculas.
2. Recorre las categorías **en este orden**; devuelve la primera que contenga algún token. Si ninguna, `"code"`.

| Orden | Rol | Tokens |
|---|---|---|
| 1 | `prompt` | prompt, prompts, template, templates |
| 2 | `api` | api, route, routes, router, controller, controllers, endpoint, endpoints, handler, handlers, webhook |
| 3 | `pipeline` | pipeline, workflow, flow, orchestrator, chain |
| 4 | `ai-model` | llm, embed, embedding, embeddings, embedder, model, agent, ai, openai, anthropic, ollama, ml |
| 5 | `database` | db, database, store, storage, repo, repository, sql, cache, vector |
| 6 | `transform` | chunk, chunker, parser, parse, transform, format, formatter, clean, normalize |
| 7 | `app` | app, main, bootstrap, server, index, cli |
| 8 | `ui` | component, components, page, pages, view, views, ui, layout |
| 9 | `service` | service, services |
| 10 | `util` | util, utils, helper, helpers, lib, common, shared |

### `deriveSubtitle(module: CodeModule): string`

**No lee `module.subtitle`** (eso lo decide quien llama con `module.subtitle ?? deriveSubtitle(module)`). Deriva solo de `module.subBlocks`:
1. "Público" = nombre que no empieza por `_` y no es un dunder (`__x__`).
2. Busca la **primera clase pública que tenga métodos públicos** (sub-bloques `kind: "method"` con `parentId` = id de esa clase). Devuelve hasta 3 de esos métodos (por `startLine`), unidos con `" · "`.
3. Si no hay tal clase: hasta 3 funciones públicas de primer nivel (`kind: "function"`), por `startLine`.
4. Si tampoco: `"<n> bloques"`.
5. Recorta a 44 caracteres con `…` si se pasa.

### `humanizeLabel(fileName: string): string`

Quita la extensión, sustituye `_` y `-` por espacios y pone cada palabra en mayúscula inicial: `"vector_store.py"` → `"Vector Store"`.

### Tests: `lib/architecture.test.ts`

- `inferRole` con estos archivos (construye `CodeModule` completos, sin `as`):

  | filePath | Rol esperado |
  |---|---|
  | `src/api/routes.py` | `api` |
  | `src/rag/pipeline.py` | `pipeline` |
  | `src/rag/chunker.py` | `transform` |
  | `src/rag/embeddings.py` | `ai-model` |
  | `src/rag/vector_store.py` | `database` |
  | `src/db/database.py` | `database` |
  | `src/llm/service.py` | `ai-model` |
  | `src/llm/prompts.py` | `prompt` |
  | `src/bootstrap/app.py` | `app` |
  | `src/misc/thing.py` | `code` |

- `deriveSubtitle`: carga `public/graphs/macro_rag_project.json` con `readFileSync` (cwd = `web/`), pásalo por `parseCodeGraph` y comprueba:
  - `src/rag/pipeline.py` → `"ingest · retrieve · answer"`
  - `src/api/routes.py` → `"ingest_document · ask_question"`
  - `src/rag/vector_store.py` → `"upsert · add_many · delete"`
- `humanizeLabel("vector_store.py") === "Vector Store"`.

**Checkpoint:** `npm run typecheck` y `npm test` pasan en `web/`.

---

## PASO 3. Regenerar el grafo del sandbox con datos de arquitectura

**Objetivo:** que `macro_rag_project.json` traiga títulos humanos, roles, subtítulos y sub-nodos.

1. **Lee `web/scripts/build-sandbox-graph.ts` entero** antes de tocar nada. Los módulos hoy salen con `label` = nombre de archivo.
2. Añade una constante `SANDBOX_ARCHITECTURE` (archivo → datos) y aplícala **después** de escanear cada módulo. Los archivos que no estén en la tabla usan `humanizeLabel` / `inferRole` / `deriveSubtitle` (importándolos de `../src/features/canvas/lib/architecture` con ruta relativa). Los archivos de la tabla que **no existan** se ignoran sin error.

| filePath | `label` | `role` | `subtitle` | `supportOf` |
|---|---|---|---|---|
| `src/api/routes.py` | API Routes | api | ask_question · ingest_document | — |
| `src/rag/pipeline.py` | RAG Pipeline | pipeline | ingest · retrieve · answer | — |
| `src/rag/chunker.py` | Chunker | transform | chunk_text | — |
| `src/llm/service.py` | LLM Service | ai-model | complete · stream_tokens | — |
| `src/db/database.py` | Notes Database | database | load · save · insert | — |
| `src/rag/vector_store.py` | Vector Store | database | upsert · search | `src/rag/pipeline.py` |
| `src/rag/embeddings.py` | Embedder | ai-model | embed · embed_many | `src/rag/pipeline.py` |
| `src/llm/prompts.py` | Prompts | prompt | build_prompt | `src/llm/service.py` |
| `src/bootstrap/app.py` | App Bootstrap | app | build_pipeline · main | — |

3. La salida debe seguir siendo **determinista** (mismo orden de campos, `JSON.stringify(…, 2)` + salto de línea final). Ejecutarlo dos veces produce el mismo archivo.
4. Si `src/bootstrap/app.py` existe pero su carpeta `bootstrap` no tiene grupo definido en el script, añade el grupo `bootstrap` ("App Bootstrap", color `rose`). Si no existe el archivo, no añadas nada.
5. **No modifiques ningún `.py` de `sandbox/`.**

**Checkpoint**
```
npm run graph:build
npm run graph:validate      # exit 0
npm test
```
Comprueba a mano en el JSON generado: `src/rag/vector_store.py` y `src/rag/embeddings.py` tienen `"supportOf": "src/rag/pipeline.py"`; `src/llm/prompts.py` tiene `"supportOf": "src/llm/service.py"`; los `label` son los humanos de la tabla. Ejecuta `graph:build` una segunda vez y confirma que el archivo no cambia. Si `search.test.ts` o `ideSync.test.ts` fallan por las nuevas etiquetas, ajústalos (los rangos de líneas no cambian).

---

## PASO 4. Base visual: tokens, tipografía, utilidades

### 4.1 `web/src/app/globals.css` (sustituye el contenido)

```css
@import "tailwindcss";

@theme {
  --font-sans: ui-sans-serif, system-ui, "Segoe UI", Inter, sans-serif;
  --color-canvas: #f8fafc;      /* slate-50: fondo del lienzo */
  --color-surface: #ffffff;
  --color-line: #e5e5e5;        /* neutral-200: bordes */
  --color-line-strong: #d4d4d4; /* neutral-300 */
  --color-ink: #171717;         /* neutral-900: texto e iconos oscuros */
  --color-ink-2: #525252;       /* neutral-600: texto secundario */
  --color-ink-3: #737373;       /* neutral-500: pistas */
  --color-accent: #ff6d5a;      /* solo anillos y foco */
}

:root {
  color-scheme: light;
}

body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

.react-flow {
  --xy-background-color: var(--color-canvas);
  --xy-edge-stroke: #a3a3a3;
  --xy-edge-stroke-selected: var(--color-ink);
  --xy-handle-background-color: #a3a3a3;
  --xy-handle-border-color: #ffffff;
}

.react-flow__node {
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
```

### 4.2 `web/src/app/layout.tsx`

Lee antes lo relevante en `web/node_modules/next/dist/docs/`. Cambia solo el `<body>`:

```tsx
<body className="h-dvh overflow-hidden bg-canvas text-ink antialiased">{children}</body>
```

### 4.3 Crea `web/src/lib/cn.ts`

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### 4.4 Crea `web/src/lib/motion.ts`

```ts
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Duración de animaciones de React Flow: 0 si el usuario pidió reducir el movimiento. */
export function useMotionDuration(ms: number): number {
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  return reduced ? 0 : ms;
}
```

### 4.5 `web/src/components/ConnectionBadge.tsx` (restyle; también lo usa `/debug`)

```tsx
"use client";

import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import type { ConnectionStatus } from "@/lib/ws/TeacherSocketManager";

const LABEL: Record<ConnectionStatus, string> = {
  open: "Online",
  connecting: "Conectando…",
  closed: "Offline",
};

const STYLE: Record<ConnectionStatus, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-700",
  connecting: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-rose-200 bg-rose-50 text-rose-700",
};

const DOT: Record<ConnectionStatus, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-rose-500",
};

export function ConnectionBadge() {
  const status = useTeacherStatus();
  return (
    <p
      role="status"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        STYLE[status],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {LABEL[status]}
    </p>
  );
}
```

**Checkpoint:** `npm run typecheck` y `npm run build` pasan. (Las pantallas se verán a medias porque los componentes antiguos siguen en oscuro: es normal.)

---

## PASO 5. Estado: drawer, popovers, vista y foco de lección

Edita `web/src/features/canvas/store.ts` (léelo antes; conserva todo lo existente).

### 5.1 Tipos y estado nuevos

```ts
export type AppView = "architecture" | "lessons";
export type DrawerTab = "code" | "lesson";
export type PopoverId = "search" | "filters" | "settings";
export interface LayoutStats { ms: number; modules: number; blocks: number }

// dentro de CanvasState:
view: AppView;
drawer: { open: boolean; tab: DrawerTab; moduleId: string | null };
popover: PopoverId | null;
lessonFocusIds: ReadonlySet<string>;
layoutStats: LayoutStats | null;
setView: (view: AppView) => void;
openDrawer: (moduleId: string | null, tab: DrawerTab) => void;
closeDrawer: () => void;
setDrawerTab: (tab: DrawerTab) => void;
setPopover: (popover: PopoverId | null) => void;
setLessonFocus: (ids: ReadonlySet<string>) => void;
setLayoutStats: (stats: LayoutStats | null) => void;
deselect: () => void;
```

### 5.2 Valores iniciales y acciones

- Iniciales: `view: "architecture"`, `drawer: { open: false, tab: "code", moduleId: null }`, `popover: null`, `lessonFocusIds: new Set<string>()`, `layoutStats: null`.
- `openDrawer(moduleId, tab)`: fija `drawer: { open: true, tab, moduleId: moduleId ?? state.drawer.moduleId }`. Si `moduleId` no es `null`, además `selectedModuleId: moduleId` y `selectedSubBlockId: null`.
- `closeDrawer()`: `drawer: { ...state.drawer, open: false }`.
- `deselect()`: solo `selectedModuleId: null, selectedSubBlockId: null`. **No** envía `CLEAR_HIGHLIGHTS`.
- `setGraph(...)`: además de lo que ya resetea, deja `drawer` cerrado con `moduleId: null`, `popover: null`, `lessonFocusIds` vacío y `layoutStats: null`.

### 5.3 Crea `web/src/features/canvas/lib/actions.ts`

```ts
import { buildClear } from "@/lib/protocol";
import { sendTeacherMessage } from "@/hooks/useTeacherSocket";
import { useCanvasStore } from "../store";

/** Quita el resaltado en el IDE y la selección en el canvas. */
export function clearHighlights(): void {
  sendTeacherMessage(buildClear());
  useCanvasStore.getState().clearSelection();
}
```

**Checkpoint:** `npm run typecheck` pasa.

---

## PASO 6. Núcleo del lienzo: tema, layout, flujo y nodos

> En este paso el código **puede no compilar a mitad** (los componentes antiguos usan constantes que desaparecen). Exige el typecheck **solo al final**.

### 6.1 Reescribe `web/src/features/canvas/theme.ts`

Elimina `NODE_WIDTH`, `HEADER_HEIGHT`, `ROW_HEIGHT`, `MAX_VISIBLE_ROWS`, `nodeHeight` y `KIND_ICON`.

```ts
import type { LucideIcon } from "lucide-react";
import {
  Code2, Database, LayoutDashboard, MessageSquareText, Rocket, Scissors,
  Server, Sparkles, Webhook, Workflow, Wrench,
} from "lucide-react";
import type { GroupColor, ModuleRole } from "@core/graph";

export const CARD_WIDTH = 272;
export const CARD_HEIGHT = 80;
export const SUPPORT_SIZE = 56;
export const SUPPORT_SLOT = 96;   // ancho reservado por sub-nodo
export const SUPPORT_GAP = 72;    // hueco vertical tarjeta → sub-nodo
export const SUPPORT_LABEL = 40;  // alto reservado para la etiqueta
export const MINIMAP_WIDTH = 200;
export const MINIMAP_HEIGHT = 128;

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
  api: Webhook,
  pipeline: Workflow,
  database: Database,
  "ai-model": Sparkles,
  transform: Scissors,
  prompt: MessageSquareText,
  app: Rocket,
  service: Server,
  ui: LayoutDashboard,
  util: Wrench,
  code: Code2,
};

export const ROLE_LABEL: Record<ModuleRole, string> = {
  api: "API",
  pipeline: "Flujo",
  database: "Base de datos",
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
  sky:     { dot: "bg-sky-500",     chip: "border-sky-200 bg-sky-50 text-sky-700",             hex: "#0ea5e9" },
  emerald: { dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700", hex: "#10b981" },
  violet:  { dot: "bg-violet-500",  chip: "border-violet-200 bg-violet-50 text-violet-700",    hex: "#8b5cf6" },
  amber:   { dot: "bg-amber-500",   chip: "border-amber-200 bg-amber-50 text-amber-700",       hex: "#f59e0b" },
  rose:    { dot: "bg-rose-500",    chip: "border-rose-200 bg-rose-50 text-rose-700",          hex: "#f43f5e" },
  zinc:    { dot: "bg-neutral-500", chip: "border-neutral-200 bg-neutral-100 text-neutral-700", hex: "#737373" },
};
```

### 6.2 Crea `web/src/features/drawer/kindIcons.ts` y mueve las filas

- `kindIcons.ts`: exporta `KIND_ICON: Record<SubBlockKind, LucideIcon>` con `class: Box`, `function: SquareFunction`, `method: Braces`, `block: Blocks` (lo que había en el `theme.ts` antiguo).
- Mueve `nodes/SubBlockRow.tsx` a `features/drawer/SubBlockRow.tsx` (se restyla en el Paso 9). Para que compile ahora: sustituye su `ROW_HEIGHT` por una constante local `const ROW_HEIGHT = 36;` y su import de `KIND_ICON` por `./kindIcons`.
- Mueve la función `orderedSubBlocks` que hoy vive dentro de `ModuleNode.tsx` a `features/drawer/lib/orderSubBlocks.ts` (misma lógica: cada clase seguida de sus métodos; los sueltos al final). La necesitará el drawer.
- Actualiza `components/FilterBar.tsx` para que importe `KIND_ICON` de `@/features/drawer/kindIcons` (se borrará en el Paso 8; solo para que compile).

### 6.3 Reescribe `web/src/features/canvas/lib/layout.ts`

Mantén la firma `layoutGraph(graph: CodeGraph): Map<string, GraphPosition>` y el tipo `GraphPosition`.

- dagre recibe **solo los módulos principales** (sin `supportOf`), con `footprint(nSupports)` como ancho y alto. Configuración: `rankdir: "LR"`, `nodesep: 56`, `ranksep: 140`.
- Solo se añaden a dagre las aristas cuyos **dos** extremos son módulos principales y distintos.
- Cada tarjeta se coloca **arriba y centrada horizontalmente** en su footprint: `cx = node.x`, `top = node.y - footprint.height / 2`, `cardX = cx - CARD_WIDTH / 2`, `cardY = top`.
- Sub-nodo `i` de `n` (orden = orden de aparición en `graph.modules`):
  `x = cx - (n * SUPPORT_SLOT) / 2 + i * SUPPORT_SLOT + (SUPPORT_SLOT - SUPPORT_SIZE) / 2`
  `y = cardY + CARD_HEIGHT + SUPPORT_GAP`
- Devuelve posiciones para **todos** los módulos (principales y de apoyo).

### 6.4 Reescribe `web/src/features/canvas/lib/flow.ts`

Tipos:

```ts
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { CodeGraph, CodeModule, GroupColor, ModuleRole } from "@core/graph";

export type ModuleNodeData = {
  module: CodeModule;
  groupColor: GroupColor;
  groupLabel: string;
  role: ModuleRole;
  subtitle: string;
  supports: Array<{ id: string; label: string }>;
};
export type SupportNodeData = Omit<ModuleNodeData, "supports">;
export type ModuleFlowNode = Node<ModuleNodeData, "module">;
export type SupportFlowNode = Node<SupportNodeData, "support">;
export type AppFlowNode = ModuleFlowNode | SupportFlowNode;

export interface FlowResult {
  nodes: AppFlowNode[];
  edges: Edge[];
  hiddenEdges: number;
}
```

`graphToFlow(graph, positions): FlowResult`:

- **Nodos.** Un nodo por módulo. `role = module.role ?? inferRole(module)`, `subtitle = module.subtitle ?? deriveSubtitle(module)`, `groupColor` y `groupLabel` salen del grupo (por defecto `"zinc"` y el `groupId`).
  - Si `module.supportOf` existe → `type: "support"`, `width` y `height` = `SUPPORT_SIZE`.
  - Si no → `type: "module"`, `width: CARD_WIDTH`, `height: CARD_HEIGHT`, y `supports` = los módulos que lo tienen como `supportOf` (`{ id, label }`, en orden estable).
- **Aristas.** Constante `EDGE_COLOR = "#a3a3a3"`.
  1. **Aristas de apoyo:** una por cada módulo con `supportOf` válido. `id: "support:<padre>:<hijo>"`, `source: <padre>`, `target: <hijo>`, `sourceHandle: "support:<hijo>"`, `targetHandle: "in"`, `type: "smoothstep"`, `style: { stroke: EDGE_COLOR, strokeWidth: 1.5, strokeDasharray: "5 4" }`, `selectable: false`, `focusable: false`, **sin flecha**. Guarda el par `"<padre>→<hijo>"` en un `Set`.
  2. **Aristas principales:** para cada `graph.edges`, si **ningún** extremo es de apoyo: `type: "default"` (bezier), `markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 14, height: 14 }`, `style: { stroke: EDGE_COLOR, strokeWidth: 1.5 }`.
  3. **Resto** (algún extremo es de apoyo): si el par `source→target` ya está en el `Set` de apoyo, se omite sin contar. Si no, se omite y suma a `hiddenEdges`.

### 6.5 Crea los nodos

**`nodes/NodeActions.tsx`** (botones que aparecen al pasar el ratón, enfocar o seleccionar):

```tsx
import { Code2, GraduationCap, type LucideIcon } from "lucide-react";
import { useCanvasStore } from "../store";

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

export function NodeActions({ moduleId, selected }: { moduleId: string; selected: boolean }) {
  return (
    <div
      data-selected={selected}
      className="pointer-events-none absolute inset-x-0 -top-11 flex justify-center pb-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 data-[selected=true]:pointer-events-auto data-[selected=true]:opacity-100"
    >
      <div className="nodrag nopan flex items-center gap-0.5 rounded-lg border border-line bg-white p-0.5 shadow-md">
        <ActionButton
          icon={Code2}
          label="Explorar código"
          onClick={() => useCanvasStore.getState().openDrawer(moduleId, "code")}
        />
        <ActionButton
          icon={GraduationCap}
          label="Ver explicación"
          onClick={() => useCanvasStore.getState().openDrawer(moduleId, "lesson")}
        />
      </div>
    </div>
  );
}
```

**`nodes/ModuleNode.tsx`** (reescribe entero; tarjeta limpia, **sin filas ni números**):

```tsx
import { memo } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import type { ModuleFlowNode } from "../lib/flow";
import { useCanvasStore } from "../store";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  GROUP_STYLES,
  ROLE_ICON,
  supportHandlePercent,
} from "../theme";
import { NodeActions } from "./NodeActions";

const HANDLE =
  "size-2.5! rounded-full! border-2! border-white! bg-neutral-400! hover:bg-ink!";
const DIAMOND =
  "size-3! rounded-none! border-0! bg-neutral-400! [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

function ModuleNodeComponent({ id, data }: NodeProps<ModuleFlowNode>) {
  const selected = useCanvasStore((s) => s.selectedModuleId === id);
  const ideHere = useCanvasStore((s) => s.activeModuleId === id);
  const lessonFocus = useCanvasStore((s) => s.lessonFocusIds.has(id));
  const dimmed = useCanvasStore((s) => s.match !== null && !s.match.modules.has(id));
  const compact = useStore((s) => s.transform[2] < 0.45);
  const { module, role, subtitle, groupColor, groupLabel, supports } = data;
  const Icon = ROLE_ICON[role];

  return (
    <article
      data-module={id}
      aria-label={module.label}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={cn(
        "group relative rounded-xl border border-line bg-white shadow-md transition-shadow duration-150 hover:shadow-lg",
        dimmed && "opacity-30",
        selected && "ring-2 ring-accent",
        lessonFocus && "ring-2 ring-sky-500 shadow-lg",
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE} />

      <div className="flex h-full items-center gap-3 px-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-white"
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-ink">{module.label}</h3>
          {compact ? null : (
            <p className="truncate text-xs leading-4 text-ink-2">{subtitle}</p>
          )}
        </div>
      </div>

      <span
        title={groupLabel}
        className={cn("absolute right-3 top-3 size-2 rounded-full", GROUP_STYLES[groupColor].dot)}
      />
      {ideHere ? (
        <span
          title="El cursor del IDE está aquí"
          className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      ) : null}

      {supports.map((support, index) => (
        <Handle
          key={support.id}
          type="source"
          position={Position.Bottom}
          id={`support:${support.id}`}
          isConnectable={false}
          style={{ left: `${supportHandlePercent(index, supports.length)}%` }}
          className={DIAMOND}
        />
      ))}
      <Handle type="source" position={Position.Right} className={HANDLE} />

      {compact ? null : <NodeActions moduleId={id} selected={selected} />}
    </article>
  );
}

export const ModuleNode = memo(ModuleNodeComponent);
```

**`nodes/SupportNode.tsx`** (sub-nodo circular). Sigue el mismo patrón que `ModuleNode`:
- Contenedor `relative` con `style={{ width: SUPPORT_SIZE, height: SUPPORT_SIZE }}` y clase `group`.
- Círculo: `grid size-14 place-items-center rounded-full border border-line-strong bg-white text-ink shadow-md transition-shadow hover:shadow-lg`, con el icono del rol a `size-6`. Mismos anillos y opacidades que `ModuleNode`: `selected` → `ring-2 ring-accent`, `lessonFocus` → `ring-2 ring-sky-500`, `dimmed` → `opacity-30`, `ideHere` → punto verde.
- Etiqueta (solo si no `compact`): `<span className="pointer-events-none absolute left-1/2 top-full mt-1.5 w-24 -translate-x-1/2 text-center text-[11px] font-medium leading-tight text-ink-2 line-clamp-2">{module.label}</span>`.
- Asa de entrada: `<Handle type="target" position={Position.Top} id="in" isConnectable={false} className={DIAMOND} />` (usa la misma constante `DIAMOND`; exporta las constantes desde `theme.ts` si prefieres no duplicarlas).
- Reutiliza `<NodeActions moduleId={id} selected={selected} />`.
- Componente `memo`, tipado con `NodeProps<SupportFlowNode>`.

**`nodes/nodeTypes.ts`**: `export const nodeTypes = { module: ModuleNode, support: SupportNode };` (fuera de cualquier componente).

### 6.6 Ajustes mínimos para que compile

- `CanvasView.tsx`: cambia los tipos `ModuleFlowNode` por `AppFlowNode`; sustituye temporalmente `colorMode="dark"` por `colorMode="light"` y quita la referencia a `GROUP_STYLES[...].hex` del `MiniMap` (se rehace en el Paso 7). No hagas aún el diseño final.
- `CanvasApp.tsx`: el nuevo `graphToFlow` devuelve `{ nodes, edges, hiddenEdges }`; adapta el uso. En `paintEdges` cambia los colores: aristas incidentes `stroke: "#171717", strokeWidth: 2, opacity: 1`; resto `opacity: 0.25` (mantiene el spread de `edge.style` para no perder el discontinuo).
- Actualiza `lib/layout.test.ts` (léelo antes): ya no existe `nodeHeight`. Escribe una comprobación nueva:
  - Todos los módulos tienen posición.
  - **Ningún par de rectángulos se solapa**, contando tarjetas (`CARD_WIDTH × CARD_HEIGHT`) y sub-nodos con su etiqueta (`SUPPORT_SLOT × (SUPPORT_SIZE + SUPPORT_LABEL)`).
  - Cada sub-nodo queda **centrado horizontalmente** bajo su padre (tolerancia 1 px).
  - `supportHandlePercent(i, n)` queda entre 10 y 90 para `n` de 1 a 6.
- Crea `lib/flow.test.ts` (sobre el JSON regenerado en el Paso 3, pasado por `parseCodeGraph`):
  - Los 3 módulos con `supportOf` son nodos `type: "support"`; los demás, `type: "module"`.
  - Hay exactamente una arista de apoyo por sub-nodo, con `strokeDasharray`, `sourceHandle` `support:<id>` y `targetHandle` `in`.
  - No hay arista principal duplicada para el par padre→sub-nodo.
  - `hiddenEdges` es un entero ≥ 0 (cuenta las aristas que tocan sub-nodos desde otros módulos).

**Checkpoint:** `npm run typecheck`, `npm test` y `npm run build` pasan en `web/`.

---

## PASO 7. Lienzo final: dot grid, minimapa y controles

### 7.1 `web/src/features/canvas/CanvasView.tsx` (reescribe)

```tsx
"use client";

import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IdeDock } from "./components/IdeDock";
import { ZoomControls } from "./components/ZoomControls";
import type { AppFlowNode } from "./lib/flow";
import { nodeTypes } from "./nodes/nodeTypes";
import { useCanvasStore } from "./store";
import { MINIMAP_HEIGHT, MINIMAP_WIDTH } from "./theme";

interface CanvasViewProps {
  nodes: AppFlowNode[];
  edges: Edge[];
}

export function CanvasView({ nodes, edges }: CanvasViewProps) {
  return (
    <div className="absolute inset-0">
      <ReactFlow<AppFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="light"
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={1.5}
        nodesConnectable={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        onNodeClick={(_, node) => useCanvasStore.getState().selectModule(node.id)}
        onNodeDoubleClick={(_, node) => useCanvasStore.getState().openDrawer(node.id, "code")}
        onPaneClick={() => useCanvasStore.getState().deselect()}
        proOptions={{ hideAttribution: true }}
        className="bg-canvas"
      >
        {/* Dot grid: puntos slate-300, cada 20 px, tamaño 1.5 */}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cbd5e1" />
        <MiniMap<AppFlowNode>
          position="bottom-right"
          pannable
          zoomable
          style={{
            width: MINIMAP_WIDTH,
            height: MINIMAP_HEIGHT,
            borderRadius: 12,
            border: "1px solid #e5e5e5",
          }}
          bgColor="#ffffff"
          maskColor="rgba(248, 250, 252, 0.7)"
          nodeColor={(node) => (node.type === "support" ? "#a3a3a3" : "#404040")}
          nodeBorderRadius={6}
        />
        <ZoomControls />
        <IdeDock />
      </ReactFlow>
    </div>
  );
}
```

Si `dist/style.css` de React Flow mete estilos que rompan el aspecto (por ejemplo un fondo o borde que sobreescriba el `bg-canvas`), corrígelos con las variables `--xy-*` del `globals.css`, no con `!important` en componentes.

### 7.2 Crea `web/src/features/canvas/components/ZoomControls.tsx`

```tsx
"use client";

import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { Eraser, Maximize2, Minus, Plus } from "lucide-react";
import { useMotionDuration } from "@/lib/motion";
import { clearHighlights } from "../lib/actions";
import { MINIMAP_HEIGHT } from "../theme";

const BUTTON =
  "grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const percent = useStore((s) => Math.round(s.transform[2] * 100));
  const duration = useMotionDuration(200);

  return (
    <Panel
      position="bottom-right"
      style={{ marginBottom: 15 + MINIMAP_HEIGHT + 10 }}
      className="flex items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-md"
    >
      <button type="button" className={BUTTON} title="Alejar" aria-label="Alejar" onClick={() => void zoomOut({ duration })}>
        <Minus className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="h-8 min-w-12 rounded-lg px-1 text-xs font-medium tabular-nums text-ink-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent"
        title="Restablecer zoom"
        onClick={() => void zoomTo(1, { duration })}
      >
        {percent}%
      </button>
      <button type="button" className={BUTTON} title="Acercar" aria-label="Acercar" onClick={() => void zoomIn({ duration })}>
        <Plus className="size-4" aria-hidden />
      </button>
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <button
        type="button"
        className={BUTTON}
        title="Centrar vista"
        aria-label="Centrar vista"
        onClick={() => void fitView({ padding: 0.25, maxZoom: 1, duration })}
      >
        <Maximize2 className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={BUTTON}
        title="Limpiar resaltado (Esc)"
        aria-label="Limpiar resaltado"
        onClick={clearHighlights}
      >
        <Eraser className="size-4" aria-hidden />
      </button>
    </Panel>
  );
}
```

### 7.3 `components/IdeDock.tsx` (solo restyle)

Cambia el `Panel` a `position="bottom-left"` y su `className` a:

`rounded-lg border border-line bg-white/90 px-3 py-1.5 font-mono text-[11px] text-ink-2 shadow-md backdrop-blur`

El contenido (`En el IDE · {file}:{line} · {saved}`) y su suscripción no cambian.

**Checkpoint:** `npm run typecheck`, `npm run lint` y `npm run build` pasan. Si puedes abrir el navegador: `http://localhost:3000` muestra fondo claro con puntos, tarjetas blancas, sub-nodos circulares con línea discontinua, y minimapa y controles abajo a la derecha.

---

## PASO 8. Shell: header, barra izquierda y popovers

### 8.1 Crea `features/canvas/lib/useCanvasKeys.ts`

Hook que registra **un** `keydown` en `document` (con `useEffect`) y lo limpia al desmontar:

- `/` (sin modificadores y sin estar escribiendo en un input, textarea o `contenteditable`): `preventDefault()` y `setPopover("search")`.
- `Escape`: si hay un popover abierto, no hagas nada (el propio `Popover` lo cierra, ver 8.3). Si no, llama a `clearHighlights()`.
- `Enter` con el foco en un nodo de React Flow (`event.target` es un `HTMLElement` con la clase `react-flow__node` y `dataset.id`): `openDrawer(dataset.id, "code")`.

### 8.2 Crea `components/AppHeader.tsx`

```tsx
"use client";

import { ChevronRight, GraduationCap } from "lucide-react";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { cn } from "@/lib/cn";
import { useCanvasStore, type AppView } from "../store";

const TABS: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "architecture", label: "Arquitectura" },
  { id: "lessons", label: "Lecciones" },
];

export function AppHeader({ projectName }: { projectName: string }) {
  const view = useCanvasStore((s) => s.view);
  const selectedModuleId = useCanvasStore((s) => s.selectedModuleId);

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-white px-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <nav aria-label="Ruta del proyecto" className="flex min-w-0 items-center gap-2 text-sm">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-white"
          aria-hidden
        >
          <GraduationCap className="size-4" />
        </span>
        <span className="hidden text-ink-3 lg:inline">TeacherCanvas</span>
        <ChevronRight className="hidden size-3.5 text-ink-3 lg:inline" aria-hidden />
        <span className="truncate font-medium text-ink">{projectName}</span>
      </nav>

      <div
        role="tablist"
        aria-label="Vista"
        className="absolute left-1/2 flex -translate-x-1/2 rounded-lg bg-neutral-100 p-0.5"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => useCanvasStore.getState().setView(id)}
            className={cn(
              "h-8 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent",
              view === id ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ConnectionBadge />
        <button
          type="button"
          onClick={() => useCanvasStore.getState().openDrawer(selectedModuleId, "lesson")}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-medium text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <GraduationCap className="size-4" aria-hidden />
          Cargar lección / Explicar
        </button>
      </div>
    </header>
  );
}
```

### 8.3 Crea `components/Popover.tsx`

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCanvasStore, type PopoverId } from "../store";

interface PopoverProps {
  id: PopoverId;
  title: string;
  anchor?: "top" | "bottom";
  children: ReactNode;
}

export function Popover({ id, title, anchor = "top", children }: PopoverProps) {
  const open = useCanvasStore((s) => s.popover === id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || target.closest("[data-rail-button]")) return;
      useCanvasStore.getState().setPopover(null);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation(); // que el Esc global (limpiar resaltado) no se dispare
      useCanvasStore.getState().setPopover(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className={cn(
        "absolute left-full ml-2 w-80 rounded-xl border border-line bg-white shadow-lg",
        anchor === "top" ? "top-3" : "bottom-3",
      )}
    >
      {children}
    </div>
  );
}
```

### 8.4 Crea `components/LeftRail.tsx`

Barra vertical de 56 px con tres botones de 40 px:

| Posición | Icono | `aria-label` / `title` | Abre |
|---|---|---|---|
| Arriba | `Plus` | Buscar módulo (/) | popover `search` → `<ModulePicker />` |
| Arriba | `SlidersHorizontal` | Filtros | popover `filters` → `<FiltersPanel />` |
| Abajo (`mt-auto`) | `Settings` | Configuración | popover `settings` (`anchor="bottom"`) → `<SettingsPanel />` |

Detalles:
- `<nav aria-label="Herramientas" className="relative z-30 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3">`.
- Botón: `data-rail-button`, `aria-expanded={popover === id}`, `className={cn("grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-neutral-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent", activo && "bg-ink text-white hover:bg-ink hover:text-white")}`.
- Un clic alterna: `setPopover(popover === id ? null : id)`.
- Los `<Popover>` van dentro del `<nav>` (así se anclan a la derecha de la barra).

### 8.5 Crea los contenidos de los popovers

**`components/ModulePicker.tsx`**
- Estado **local** (no toca el `query` global, para no atenuar el lienzo mientras se escribe): `useState` para la consulta, con debounce de 150 ms.
- Campo de búsqueda arriba (`Search` + `<input autoFocus>`, `placeholder="Buscar módulo"`, `text-sm`).
- Lista debajo, `max-h-80 overflow-y-auto`, con los módulos que devuelve `matchModules(indexes, { query, groups: new Set(), kinds: new Set() })` (si devuelve `null`, todos). Agrupados por grupo con su punto de color. Cada fila: icono de rol en recuadro `size-8 rounded-lg bg-ink text-white`, `label` (`text-sm font-medium`) y debajo, en `text-xs text-ink-2`, hasta 2 nombres de sub-bloques que coincidan (si hay consulta).
- `↑` / `↓` mueven la fila activa y `Enter` selecciona. También clic.
- Al seleccionar: `selectModule(id)`, `fitView({ nodes: [{ id }], padding: 0.4, maxZoom: 1, duration })` (con `useMotionDuration`, dentro del `ReactFlowProvider`) y `setPopover(null)`.
- Sin resultados: "No hay módulos que coincidan".

**`components/FiltersPanel.tsx`**
- Es el contenido del antiguo `FilterBar` pero en claro, dentro de un contenedor `p-4 flex flex-col gap-4`:
  - Título "Filtros" (`text-sm font-semibold`).
  - Sección "Grupos": chips por grupo con punto de color y conteo (`aria-pressed`). Activo: `GROUP_STYLES[color].chip`; inactivo: `border-line text-ink-2 hover:bg-neutral-50`.
  - Sección "Tipo de bloque": toggles `class`, `function`, `method`, `block` con su icono de `kindIcons`.
  - Pie: contador `{shown} / {total} módulos` y botón "Restablecer filtros".
- Usa las mismas acciones del store (`toggleGroup`, `toggleKind`, `clearFilters`). Los módulos que no coinciden se **atenúan**, no se ocultan.

**`components/SettingsPanel.tsx`**
- Contenedor `p-4 flex flex-col gap-4`, título "Configuración".
- Dos interruptores (`<button role="switch" aria-checked>`): "Enfocar IDE al navegar" (`focusEditor`) y "Seguir el cursor del IDE" (`followIde`). Interruptor: pista `h-5 w-9 rounded-full` (`bg-ink` activo, `bg-neutral-300` inactivo) con bola blanca.
- Bloque "Diagnóstico" con `layoutStats` (`layout <ms> ms · <módulos> módulos · <bloques> bloques`) en `font-mono text-xs text-ink-2`. Si es `null`, "—".
- **Solo si `process.env.NODE_ENV === "development"`:** interruptor "Simular foco de lección": al activarlo llama a `setLessonFocus(new Set(["src/rag/pipeline.py", "src/rag/vector_store.py"]))` y al desactivarlo a `setLessonFocus(new Set())`.

### 8.6 Reescribe `CanvasApp.tsx` (`ReadyCanvas`) y limpia

- Estructura:

  ```tsx
  <ReactFlowProvider>
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <AppHeader projectName={graph.projectName} />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <main className="relative min-w-0 flex-1">
          {view === "architecture" ? (
            <CanvasView nodes={flow.nodes} edges={edges} />
          ) : (
            <LessonsView />
          )}
        </main>
        <TeacherDrawer />
      </div>
    </div>
    <IdeSyncBridge />
  </ReactFlowProvider>
  ```

  (`TeacherDrawer` y `LessonsView` se crean en el Paso 9. Para que este paso compile, crea ahora stubs vacíos que devuelvan `null` y sustitúyelos en el Paso 9.)
- Llama a `useCanvasKeys()` dentro de un componente hijo de `ReactFlowProvider` (por ejemplo un `CanvasShell`).
- En el efecto que ya calcula el layout, además de `console.info`, llama a `useCanvasStore.getState().setLayoutStats({ ms, modules, blocks })`.
- Estados de carga y de error: pásalos a tema claro (`bg-canvas text-ink-3`; tarjeta de error `rounded-xl border border-rose-200 bg-white p-4 shadow-md` con título `text-rose-700`).
- **Borra** `components/Toolbar.tsx` y `components/FilterBar.tsx`. Comprueba con búsqueda que nada más los importa.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm run build` pasan. Con el navegador: header blanco de 56 px, barra izquierda de 56 px, popovers que abren y cierran con clic fuera y con Esc; `/` abre el buscador.

---

## PASO 9. Teacher Drawer y vista "Lecciones"

### 9.1 `features/drawer/TeacherDrawer.tsx`

Solo se renderiza si `drawer.open`. Estructura:

- `<aside aria-label="Panel del profesor" className="flex w-[420px] shrink-0 flex-col border-l border-line bg-white">`.
- **Cabecera** (`flex items-start gap-3 border-b border-line p-4`):
  - Recuadro de rol `grid size-10 place-items-center rounded-xl bg-ink text-white` con `ROLE_ICON[role]`.
  - Título (`text-base font-semibold text-ink`), subtítulo (`text-sm text-ink-2`) y ruta (`font-mono text-xs text-ink-3 truncate`).
  - Botón cerrar (`X`, `aria-label="Cerrar panel"`, `closeDrawer`).
  - El módulo sale de `useCanvasStore((s) => s.indexes?.modulesById.get(moduleId) ?? null)`. `role = module.role ?? inferRole(module)` y `subtitle = module.subtitle ?? deriveSubtitle(module)`.
- **Pestañas** "Código" y "Lección" (`role="tablist"`, subrayado):
  - Contenedor `flex gap-6 border-b border-line px-4`.
  - Pestaña: `-mb-px border-b-2 py-3 text-sm font-medium`; activa `border-ink text-ink`, inactiva `border-transparent text-ink-2 hover:text-ink`.
  - Cambian con `setDrawerTab`.
- **Cuerpo:** `min-h-0 flex-1 overflow-y-auto`. Tamaño de texto mínimo 14 px. Muestra `<CodeTab />` o `<LessonTab />` según la pestaña.
- **Sin módulo:** estado vacío centrado, "Selecciona un componente del lienzo" (`text-sm text-ink-3`).
- **Al abrir o cambiar de módulo:** el lienzo se reduce (el drawer está anclado, no superpuesto). Con un `useEffect` sobre `[open, moduleId]`, tras ~50 ms (`setTimeout`, para esperar al reflow), llama a `fitView({ nodes: [{ id: moduleId }], padding: 0.4, maxZoom: 1, duration })` con `useMotionDuration(300)`. Necesita `useReactFlow`, así que debe estar dentro del `ReactFlowProvider`.
- `Esc` con el foco dentro del drawer lo cierra (`onKeyDown` en el `aside`).
- Al abrir, lleva el foco al botón de cerrar o al `aside` (`tabIndex={-1}`).

### 9.2 `features/drawer/CodeTab.tsx`

- **Lista de bloques** ("Bloques de código", con contador). Usa `orderSubBlocks` (Paso 6.2). Cada fila es `SubBlockRow` restyleado (ver 9.3).
- **Conexiones** (`ConnectionsList.tsx`). Deriva de `graph.edges` y de `supportOf` con `useMemo` sobre el grafo del store:
  - "Recibe de": módulos con una arista hacia este.
  - "Envía a": módulos a los que este apunta.
  - "Usa": sub-nodos de apoyo de este módulo. Si el módulo actual es de apoyo, "Apoya a": su padre.
  - Cada elemento es un botón-chip (`rounded-lg border border-line px-2.5 py-1.5 text-sm hover:bg-neutral-50`) con el icono de rol y el `label`. Al pulsarlo: `openDrawer(otroId, "code")` (cambia el drawer a ese módulo).
  - Si una sección está vacía, no se muestra.
- **Pie fijo:** botón "Abrir archivo en el IDE" (`inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-neutral-50`). Llama a `sendTeacherMessage(buildNavigate(module.filePath, range.startLine, range.endLine, { focusEditor }))` con `moduleRange(module)` (si es `null`, el botón se desactiva).

### 9.3 `features/drawer/SubBlockRow.tsx` (restyle a claro)

Mantén la lógica y `data-subblock`. Fila `h-9`, `text-sm`, borde inferior `border-line`. Estados (con los mismos selectores de zustand que ya usa):

| Estado | Clases |
|---|---|
| Cursor del IDE aquí | `bg-emerald-50 ring-1 ring-inset ring-emerald-500 text-ink` |
| Seleccionado | `bg-neutral-100 text-ink` |
| Coincide con la búsqueda | `bg-sky-50 text-ink` |
| Normal | `text-ink hover:bg-neutral-50` |

Icono del tipo (`text-ink-3`), nombre truncado, rango `L56–68` en `font-mono text-xs text-ink-3`. Métodos con `pl-8`. Sin conexión (`online` falso): `opacity-50` y `aria-disabled`. Al hacer clic: `selectSubBlock` + `sendTeacherMessage(buildNavigate(filePath, start, end, { focusEditor }))` (igual que hoy).

Calcula `online` con `useTeacherStatus() === "open"` en `CodeTab` y pásalo a las filas.

### 9.4 `features/drawer/LessonTab.tsx`

Contiene `LessonSlot` (el punto donde el Ticket 6 montará `LessonPanel`). Hoy renderiza un estado vacío: icono `GraduationCap` en círculo gris, "Aquí verás la lección paso a paso" y un botón deshabilitado "Generar lección (próximamente)".

### 9.5 `features/drawer/StepTimeline.tsx` (los números de paso viven **solo aquí**)

Componente **presentacional**, sin dependencia de zustand ni del Ticket 6:

```ts
export interface TimelineStep {
  stepNumber: number;
  title: string;
  summary: string;
  connectionReason: string;
  locationLabel: string; // "src/rag/vector_store.py · L24–77"
}

interface StepTimelineProps {
  steps: readonly TimelineStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenInIde: (index: number) => void;
}
```

Reglas de diseño:
- Contenedor `<section tabIndex={0} onKeyDown>` donde `←` llama a `onPrev` y `→` a `onNext` (solo cuando el foco está dentro).
- `<ol className="flex flex-col p-4">`; cada `<li>` es `relative flex gap-3 pb-4 last:pb-0`.
- **Línea vertical** entre pasos: `absolute left-3.5 top-8 bottom-0 w-px bg-line-strong` (no en el último).
- **Círculo del número**: `relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold`. Activo o completado: `bg-ink text-white`; pendiente: `bg-neutral-200 text-ink-2`. Los completados muestran el icono `Check` en lugar del número. `aria-label="Paso N: título"` y `aria-current="step"` en el activo.
- **Paso activo:** tarjeta expandida `rounded-xl border border-line bg-white p-4 shadow-md` con:
  - Título `text-[15px] font-semibold text-ink`.
  - Resumen `mt-1 text-sm leading-6 text-ink-2`.
  - Chip de ubicación `mt-3 inline-flex rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs text-ink-2`.
  - Botón "Ver en el IDE" (`onOpenInIde`).
  - Nota `mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-ink-2` con el texto `Conecta con el siguiente →` (o `Final del recorrido` en el último paso) seguido de `connectionReason`.
- **Pasos inactivos:** solo el título en un botón `text-left text-sm text-ink-2 hover:text-ink`; los pendientes con `opacity-70`.
- **Pie fijo** (`sticky bottom-0 flex items-center justify-between border-t border-line bg-white p-3`): botón "Anterior", texto `Paso {n} de {total}` y botón "Siguiente" (deshabilitados en los extremos).

### 9.6 `features/canvas/components/LessonsView.tsx`

Estado vacío centrado para la vista "Lecciones" (el equivalente de "Executions"): "Aún no hay lecciones. Selecciona un componente y pulsa Ver explicación." (`text-sm text-ink-3`, icono `GraduationCap` en círculo gris). Sustituye el stub del Paso 8.

**Checkpoint:** `npm run typecheck`, `npm run lint`, `npm run build` pasan. Con el navegador: el botón "Explorar código" abre el drawer de 420 px con los bloques del módulo; el lienzo se encoge sin tapar el minimapa; un clic en `VectorStore.search` resalta 56–68 en VS Code.

---

## PASO 10. Pantalla `/debug` y restos oscuros

1. `web/src/app/debug/page.tsx` y `web/src/components/BridgeTestPanel.tsx`: pásalos a claro con esta tabla de sustitución:

   | Antes | Después |
   |---|---|
   | `bg-zinc-900`, `bg-zinc-950` | `bg-white` / `bg-canvas` |
   | `border-zinc-800`, `border-zinc-700` | `border-line` |
   | `text-zinc-100` | `text-ink` |
   | `text-zinc-300`, `text-zinc-400` | `text-ink-2` |
   | `text-zinc-500`, `text-zinc-600` | `text-ink-3` |
   | `bg-sky-600 text-white` (botón primario) | `bg-ink text-white hover:bg-neutral-800` |
   | `enabled:hover:bg-zinc-800` | `enabled:hover:bg-neutral-100` |

2. Añade a `/debug` una sección "Demo de StepTimeline" que renderice `StepTimeline` con **4 pasos falsos** y estado local para `activeIndex` (`onSelect`, `onPrev`, `onNext` los mueven; `onOpenInIde` puede llamar a `console.info`). Es solo para verificar el diseño sin IA.
3. Búsqueda global de restos oscuros. En `web/src` no debe quedar ninguna coincidencia (ignora `node_modules`):
   ```powershell
   Select-String -Path C:\Users\alexc\OneDrive\Documentos\TEACHER\web\src -Recurse -Pattern 'zinc-9|zinc-8|zinc-7|zinc-6|bg-zinc-950|text-zinc-100|colorMode="dark"'
   ```

**Checkpoint:** la búsqueda no devuelve nada; `npm run typecheck`, `npm run lint`, `npm test` y `npm run build` pasan.

---

## PASO 11. Verificación final e informe

### 11.1 Automática

```
npm run typecheck      # en web/ y en la raíz
npm run lint
npm test
npm run build
npm run graph:build && npm run graph:validate
```

### 11.2 Criterios visuales y funcionales

Con el Extension Development Host sobre `sandbox/`, `npm run dev` en `web/`, a 1920×1080 y zoom del navegador al 100 %. Marca cada uno como **OK**, **FALLA** o **requiere verificación humana**.

1. **Lienzo:** el fondo de `.react-flow` es `rgb(248, 250, 252)` y se ven puntos grises claros cada ~20 px que se desplazan y escalan con el pan y el zoom.
2. **Header:** 56 px, blanco, con sombra sutil y borde inferior. Breadcrumb "TeacherCanvas › sandbox", selector "Arquitectura / Lecciones" centrado, badge "Online" (verde) y botón oscuro "Cargar lección / Explicar". Al cerrar el Extension Development Host pasa a "Offline" (rosa) y vuelve a "Online" al reabrirlo.
3. **Barra izquierda:** 56 px con `+`, filtros y configuración (abajo), con tooltips. Cada uno abre su popover; `Esc` y clic fuera lo cierran; `/` abre el buscador.
4. **Tarjetas:** 272 × 80 px, `border-radius` 12 px, borde `#e5e5e5`, `shadow-md`. Icono en recuadro de 44 px con fondo `rgb(23, 23, 23)`, título en negrita de 15 px y subtítulo de 12 px gris. Se ven 5 tarjetas principales: API Routes, RAG Pipeline, Chunker, LLM Service, Notes Database.
5. **Sub-nodos:** Vector Store y Embedder cuelgan de RAG Pipeline; Prompts, de LLM Service. Son círculos de 56 px con etiqueta debajo, unidos por líneas **discontinuas** a asas en forma de diamante en el borde inferior del padre.
6. **Conectores principales:** líneas continuas grises con curvatura bezier y flecha, de izquierda a derecha. Al seleccionar una tarjeta, sus aristas se oscurecen y engrosan y el resto baja al 25 % de opacidad.
7. **Sin números en el lienzo.** En la consola del navegador:
   ```js
   [...document.querySelectorAll('.react-flow__node')].some(n => /(paso|step)\s*\d|^\s*\d+\s*$/im.test(n.innerText))
   ```
   debe devolver `false`. También con "Simular foco de lección" activo (Configuración, solo en desarrollo): las tarjetas reciben anillo azul y siguen sin números.
8. **Acciones al pasar el ratón:** al pasar sobre una tarjeta o sub-nodo aparece "Explorar código | Ver explicación" arriba, sin parpadear al subir el ratón. También al enfocar con teclado y al seleccionar.
9. **Drawer:** "Explorar código" abre el panel de 420 px anclado a la derecha; el lienzo se encoge y el minimapa y los controles siguen visibles. La pestaña "Código" lista los bloques con su rango (`L56–68`). Un clic en `VectorStore.search` resalta en VS Code exactamente las líneas 56–68 de `vector_store.py`; `cosine_similarity`, 80–95. Al mover el cursor en VS Code, la fila correspondiente se marca en verde y la tarjeta muestra el punto verde.
10. **Pasos solo en el drawer:** `/debug` muestra `StepTimeline` con círculos numerados, línea vertical, paso activo expandido con "Conecta con el siguiente →" y navegación con `←`/`→`.
11. **Minimapa y controles:** abajo a la derecha, minimapa blanco de 200 × 128 px con bordes redondeados y los controles (`−`, `%`, `+`, centrar, limpiar) justo encima. El porcentaje se actualiza al hacer zoom; "Centrar" y "Limpiar resaltado" funcionan.
12. **Búsqueda y filtros:** teclear `vector` en el buscador muestra "Vector Store" y `Enter` lo centra. Los chips de grupo atenúan (no ocultan) los módulos que no coinciden; el contador muestra `n / total módulos`.
13. **Layout:** ninguna tarjeta, sub-nodo o etiqueta se solapa. El layout del sandbox tarda menos de 100 ms (Configuración → Diagnóstico).
14. **Rendimiento:** con `npm run graph:stress` y `http://localhost:3000/?graph=stress`, el pan y el zoom se mantienen fluidos (sin tareas largas sostenidas de más de 50 ms en DevTools) y por debajo de zoom 0.45 las tarjetas pasan a modo compacto (sin subtítulo ni barra de acciones).
15. **Responsive:** sin scroll horizontal a 1280 × 720 y a 1920 × 1080. A 1024 px el breadcrumb reduce el texto (solo el proyecto) y no hay solape con las pestañas.
16. **Accesibilidad:** todos los controles muestran `focus-visible` con el contorno del color de acento; el orden de tabulación es barra izquierda → lienzo → drawer; el texto tiene contraste ≥ 4.5:1. Con `prefers-reduced-motion` activado, `fitView`, zoom y transiciones no animan.
17. **Regresión de la Fase 1:** `http://localhost:3000/debug` sigue mostrando los tres botones originales funcionando.

### 11.3 Informe final (formato)

Entrega al usuario, en este orden:
1. **Pasos completados** (0–11) y comandos que pasan.
2. **Archivos creados / modificados / eliminados** (lista corta).
3. **Criterios 1–17:** OK / FALLA / requiere verificación humana. Para los que requieren verificación humana, di exactamente qué hay que mirar.
4. **Desviaciones** respecto a este documento (si las hubo) y por qué.
5. **Deuda o riesgos** que hayas detectado.

---

## Fuera de alcance (no lo hagas)

- Modo oscuro, transiciones de zoom semántico, persistencia de posiciones arrastradas.
- Generación automática de `role` / `subtitle` / `supportOf` para proyectos arbitrarios (hoy salen de `SANDBOX_ARCHITECTURE`, `inferRole` y `deriveSubtitle`).
- Implementar la lección con IA (Ticket 6): este ticket solo deja listos el contenedor (`LessonSlot`), `StepTimeline` y el anillo de foco (`lessonFocusIds`).

## Ajustes que el Ticket 6 (Bloque C) debe hacer cuando se implemente

- **Eliminar** de su alcance `LessonCanvas.tsx`, `nodes/LessonStepNode.tsx`, `lessonToFlow` y `lessonFlow.test.ts`: el lienzo nunca dibuja pasos.
- Montar `LessonPanel` dentro de `LessonTab` (en lugar de `LessonSlot`), sin panel propio de 380 px.
- Renderizar los pasos con `StepTimeline`, mapeando `LessonStep` → `TimelineStep` (`locationLabel = "<filePath> · L<start>–<end>"`).
- Al cambiar de paso: navegar en VS Code como estaba previsto y además `setLessonFocus(new Set([step.codeRef.filePath]))`. Como `module.id === filePath`, esto pinta el anillo azul en la tarjeta o sub-nodo correspondiente, sin números. Al cerrar la lección: `setLessonFocus(new Set())`.
- Sustituir el selector "Mapa | Lección" que Ticket 6 añadía a `Toolbar` por el selector "Arquitectura / Lecciones" del header, y colgar "Configurar IA" de `SettingsPanel`.
