# TICKET 8: Simulación de flujo ("Trazabilidad de ejecución") en el app vivo

> **Este documento es un runbook para un agente (Cursor / Claude Code).**
> Léelo entero antes de tocar nada y luego ejecuta los sub-tickets **8.1 → 8.6 en orden**.

---

## 0. Cómo debes trabajar

1. **Orden estricto.** No empieces un sub-ticket hasta que el checkpoint del anterior esté en verde.
2. **Checkpoint = obligatorio.** Todos desde `web/`: `npm run typecheck`, `npm test`, y `npm run lint` si existe. Si fallan, arréglalos antes de seguir.
3. **Portar ≠ copiar.** El origen es `docs/tickets/ticket-8-reference/`. Ese código se escribió contra una versión anterior del lienzo, **antes** de las capas y los subsistemas. Cada sub-ticket lista qué cambiar. Lo que no aparezca en la lista se copia tal cual.
4. **No amplíes el alcance.** No añadas dependencias. No toques archivos que el sub-ticket no menciona.
5. **Reglas del repo:** `CLAUDE.md` y `web/AGENTS.md`. TypeScript estricto y **prohibido `any`**. Los tipos compartidos van en `core/src/` y se importan con `import type`. Nada de WebSocket en componentes: usa `sendTeacherMessage` de `@/hooks/useTeacherSocket`.
6. **No hay git.** Antes de 8.1, copia `web/src` y `core/src` a `.backup/ticket-8/`.
7. **Verificación visual.** Si no tienes navegador, marca esos criterios como **"requiere verificación humana"** en el informe final. No los des por buenos.

### Decisiones ya tomadas (no las reabras)

| Tema | Referencia | Ticket 8 |
|---|---|---|
| Posición del reproductor | Arriba al centro | **Abajo al centro**, entre el `IdeDock` (abajo-izq.) y el minimapa + zoom (abajo-der.) |
| Velocidades | 0.5×, 1×, 2×, 4× | **0.5×, 1×, 2×** |
| Toggles "sincronizar IDE" y "cámara sigue" | Botones en la barra | **Sin botones**; ambos siempre activos |
| Panel de inspección | `FlowTab` propio | `FlowTab` portado sobre el `StepTimeline` vivo, con 2 props opcionales nuevas |
| Relación con el blast radius | Parcial | **Excluyentes en los dos sentidos** |
| Reloj | `requestAnimationFrame` | Igual; **cancelado al pausar, al salir y al desmontar** |

### Hecho del grafo vivo que rompe la referencia

`prepareGraph` promueve `src/rag/embeddings.py` y `src/rag/vector_store.py` de sub-nodo a tarjeta, porque están en la columna 2 y el pipeline en la 3. Por eso las aristas `support:src/rag/pipeline.py:src/rag/embeddings.py` y `support:…:vector_store.py` **ya no se dibujan**. Las aristas dibujadas son `imports:src/rag/pipeline.py:src/rag/embeddings.py` (y la equivalente de `vector_store.py`), y `layeredFlow` las **invierte** (embeddings → pipeline). El id no cambia. Solo queda una arista `support:` dibujada: `support:src/llm/service.py:src/llm/prompts.py`.

---

## 8.1 Tipos y núcleo puro (sin UI)

**Crear**

| Destino | Origen (`docs/tickets/ticket-8-reference/…`) | Cambios |
|---|---|---|
| `core/src/simulation.ts` | `core/src/simulation.ts` | Ninguno |
| `web/src/features/simulation/lib/timeline.ts` | `web/src/features/simulation/lib/timeline.ts` | Ninguno |
| `web/src/features/simulation/lib/engine.ts` | `…/lib/engine.ts` | Ninguno |
| `web/src/features/simulation/lib/route.ts` | `…/lib/route.ts` | Ninguno |
| `web/src/features/simulation/lib/payload.ts` | `…/lib/payload.ts` | Ninguno |
| `web/src/features/simulation/lib/scenario.ts` | `…/lib/scenario.ts` | Ninguno |
| `web/src/features/simulation/lib/visuals.ts` | `…/lib/visuals.ts` | Ninguno |
| `web/src/features/simulation/lib/stepView.ts` | `…/lib/stepView.ts` | Ninguno (importa `TimelineStep` de `@/features/drawer/StepTimeline`, que ya existe) |
| `web/src/features/simulation/lib/*.test.ts` | los 6 `*.test.ts` de `…/lib/` | Quita o adapta cualquier aserción sobre la velocidad `4` |

**Modificar**

- `core/src/index.ts`: añade `export type * from "./simulation.js";`, con el mismo estilo que las líneas existentes.

**Imports:** `@core/simulation` ya resuelve por el alias `@core/*` de `web/tsconfig.json`. No hay dependencias nuevas.

**Checkpoint**
- `npm run typecheck` y `npm test` en verde, con los tests nuevos de `engine`, `route`, `scenario`, `payload`, `visuals` y `stepView` pasando.
- Ningún archivo de `web/src/features/simulation/lib/` importa React ni `@xyflow/react`. Compruébalo con un grep.

---

## 8.2 Escenarios del sandbox, validados contra el lienzo real

**Crear**

- `web/src/features/canvas/lib/graphName.ts`: mueve aquí `graphNameFromLocation()`, que hoy está inline en `CanvasApp.tsx` (L28–32), y exporta `DEFAULT_GRAPH = "macro_rag_project"`. `CanvasApp.tsx` debe importarlo de aquí; borra la copia inline.
- `web/src/features/simulation/lib/drawnEdges.ts`:
  ```ts
  import type { CodeGraph } from "@core/graph";
  import { layeredFlow } from "@/features/canvas/lib/flow";
  import { layoutLayered } from "@/features/canvas/lib/layout";
  import { prepareGraph } from "@/features/canvas/lib/subsystems";
  import type { RoutingEdge } from "./route";

  /** Aristas tal como se dibujan (ya orientadas) y el grafo visible (sin módulos ocultos). */
  export function drawnGraph(graph: CodeGraph): { graph: CodeGraph; edges: RoutingEdge[] } {
    const prepared = prepareGraph(graph);
    const flow = layeredFlow(prepared, layoutLayered(prepared));
    return {
      graph: prepared.graph,
      edges: flow.edges.map(({ id, source, target }) => ({ id, source, target })),
    };
  }
  ```
  Si el alias `@/` no resuelve desde `tsx` en los scripts, usa rutas relativas.
- `web/scripts/build-sandbox-scenarios.ts`, portado de `…/web/scripts/build-sandbox-scenarios.ts` con estos cambios:
  - Sustituye `graphToFlow(...)` por `drawnGraph(graph)`, y valida con `parseScenarioFile(file, drawn.graph, drawn.edges)`.
  - `E_PIPELINE_EMBEDDER` → `` `imports:${PIPELINE}:${EMBEDDER}` ``.
  - `E_PIPELINE_STORE` → `` `imports:${PIPELINE}:${STORE}` ``.
  - `route.ts` resuelve el sentido de viaje (`reversed: true`). No intentes "desinvertir" nada.
- `web/scripts/validate-scenarios.ts`, portado de `…/web/scripts/validate-scenarios.ts` con el mismo cambio a `drawnGraph`.
- `web/public/scenarios/macro_rag_project.json`: **genéralo** con el script. No lo copies de la referencia, porque tiene las aristas `support:` que ya no existen.

**Modificar**

- `web/package.json`, en `scripts`:
  ```json
  "scenarios:build": "tsx scripts/build-sandbox-scenarios.ts",
  "scenarios:validate": "tsx scripts/validate-scenarios.ts"
  ```

**Checkpoint**
- `npm run scenarios:build` escribe el JSON y `npm run scenarios:validate` termina con código 0.
- Prueba en negativo: cambia a mano un `edgeIdToNext` a `support:src/rag/pipeline.py:src/rag/embeddings.py`. `scenarios:validate` debe fallar y nombrar esa arista. Luego regenera el JSON.
- Cada `fileReference` coincide con un sub-bloque real: lo garantiza `parseScenarioFile`, así que basta con que la validación pase.
- `npm run typecheck` y `npm test` en verde.

---

## 8.3 Store, acciones y puente (reloj sin fugas)

**Crear**

- `web/src/features/simulation/store.ts`, portado de `…/simulation/store.ts`. Cambios:
  - `export const SPEEDS = [0.5, 1, 2] as const;`
  - Borra `followCamera`, `syncIde`, `toggleSyncIde` y `toggleFollowCamera`. El puente los trata como siempre activos.
- `web/src/features/simulation/lib/actions.ts`, portado de `…/simulation/lib/actions.ts`. Cambios:
  - `startSimulation` sigue llamando a `canvas.clearImpact()` y a `canvas.setView("architecture")`, y abre el cajón con `canvas.openDrawer(null, "flow")`. El tab `"flow"` se declara en 8.6; hasta entonces **comenta esa línea con un `// TODO 8.6`** para que compile.
  - `stopSimulation` se queda igual: `stop()` + `sendTeacherMessage(buildClear())`. `buildClear` ya existe en `web/src/lib/protocol.ts`.
- `web/src/features/simulation/lib/useScenarios.ts`, portado de la referencia. Cambios:
  - Importa `graphNameFromLocation` de `@/features/canvas/lib/graphName` (creado en 8.2).
  - Firma: `useScenarios(graph: CodeGraph, edges: readonly RoutingEdge[])`. Recibe el grafo **visible** (`prepared.graph`), no el crudo.
- `web/src/features/simulation/SimulationBridge.tsx`, portado de la referencia. Cambios:
  - Borra las lecturas de `syncIde` y `followCamera`; los dos bloques del efecto 3 se ejecutan siempre.
  - **Nuevo efecto de desmontaje** (el puente vive dentro de `<ReactFlow>`, que se desmonta al ir a Historial):
    ```ts
    useEffect(() => () => useSimStore.getState().pause(), []);
    ```
  - El efecto 1 (reloj) ya devuelve `cancelAnimationFrame`. **No lo cambies a `setInterval`.**
  - El efecto 2 ya para la simulación si `impactAnalysisMode` pasa a `true`. Así cubre "entrar en blast radius sale de la simulación".

**Modificar**

- `web/src/features/canvas/CanvasApp.tsx`, en `CanvasShell`, después de `const flow = useMemo(...)`:
  ```ts
  const simEdges = useMemo(
    () => flow.edges.map(({ id, source, target }) => ({ id, source, target })),
    [flow.edges],
  );
  const simNodeIds = useMemo(
    () => flow.nodes.filter((node) => !isSubsystemNode(node)).map((node) => node.id),
    [flow.nodes],
  );
  useEffect(() => {
    useSimStore.getState().configure({ edges: simEdges, nodeIds: simNodeIds });
  }, [simEdges, simNodeIds]);
  useScenarios(prepared.graph, simEdges);
  ```
  Imports: `useSimStore` de `@/features/simulation/store` y `useScenarios` de `@/features/simulation/lib/useScenarios`.
- `web/src/features/canvas/CanvasView.tsx`: añade `<SimulationBridge />` como hijo de `<ReactFlow>`, junto a `<IdeDock />`.

**Checkpoint**
- `npm run typecheck` y `npm test` en verde.
- Manual, con React DevTools o con un `console.count` temporal que luego borras dentro de `tick`: con la simulación arrancada desde la consola (`useSimStore.getState().start("ingest-document")`), cambiar a Historial detiene los ticks. Al volver sigue pausada.
- Manual: arranca la simulación y pulsa "Analizar impacto" en un nodo. `useSimStore.getState().status` pasa a `"idle"`.

---

## 8.4 Pintado en el lienzo: nodo activo, atenuado y arista en tránsito

**Crear**

- `web/src/features/simulation/components/simEdgeStyle.ts`: cópialo de la referencia.
- `web/src/features/simulation/components/EdgePacket.tsx`: cópialo de la referencia.
- `web/src/features/canvas/edges/SupportEdge.tsx`: porta la referencia (`getSmoothStepPath` + `simEdgeStyle` + `EdgePacket`).

**Modificar**

- `web/src/app/globals.css`: añade `--color-flow: #7c3aed;` junto a los demás tokens. Debe coincidir con `FLOW_ACTIVE`.
- `web/src/features/canvas/edges/RoutedEdge.tsx`: en `RoutedEdgeComponent`, lee `useSimStore((s) => s.edgeStatus[props.id])`, aplica `simEdgeStyle(style, status)` al `BaseEdge` y renderiza `<EdgePacket edgeId={props.id} path={path} />`. Exporta `edgeTypes = { routed: RoutedEdge, support: SupportEdge }`.
- `web/src/features/canvas/lib/flow.ts`: en `graphToFlow`, las aristas de apoyo pasan de `type: "smoothstep"` a `type: "support"`. No toques estilo, handles ni ids.
- `web/src/features/canvas/lib/flow.ts`: añade `sim?: NodeSimStatus` a `ModuleNodeData`. `SupportNodeData` lo hereda por el `Omit`. Importa `NodeSimStatus` con `import type` de `@/features/simulation/lib/visuals`.
- `web/src/features/canvas/CanvasApp.tsx`:
  - Lee `const nodeStatus = useSimStore((s) => s.nodeStatus);`.
  - En el `useMemo` de `nodes`, **si `nodeStatus` no está vacío**, añade `sim: nodeStatus[node.id]` al `data` de cada nodo que no sea subsistema. Hazlo en una función `paintSimulation(nodes, nodeStatus)` que se aplique después de `paintNodes`. Los dos modos son excluyentes (8.3), así que nunca coinciden.
  - El estilo de aristas **no** pasa por `paintEdges`: lo aplica cada componente de arista, así el reloj no re-renderiza `CanvasShell`.
- `web/src/features/canvas/nodes/ModuleNode.tsx` y `nodes/SupportNode.tsx`, en el `cn(...)` del contenedor:
  - `sim === "active"` → `ring-4 ring-violet-500 shadow-lg`
  - `sim === "done"` → `border-violet-300`
  - `sim === "off"` → `opacity-25 transition-opacity duration-300`
  - `"upcoming"` o `undefined` → sin cambios

  **No** pongas números de paso en las tarjetas: la numeración vive solo en la barra y en el cajón.

**Checkpoint**
- `npm run typecheck` y `npm test` en verde. `subsystems.test.ts` sigue verde tras el cambio de tipo de arista.
- Visual:
  1. Al arrancar "Guardar un documento", los nodos fuera del escenario (p. ej. `App Bootstrap`) quedan al 25 %.
  2. El nodo del paso activo lleva anillo violeta.
  3. Entre pasos, la arista en tránsito se pinta violeta y gruesa y el paquete la recorre. En el salto pipeline → embeddings **el paquete va de derecha a izquierda**, porque la arista está dibujada al revés. Es lo esperado.
  4. Con `prefers-reduced-motion` activado en el SO, no hay viaje animado: se salta de paso en paso.
- Rendimiento: con la simulación en marcha, el Profiler de React DevTools no muestra `CanvasShell` re-renderizando en cada fotograma, solo en cada cambio de paso.

---

## 8.5 Reproductor inferior y botón de la cabecera

**Crear**

- `web/src/features/simulation/components/PlayerBar.tsx`, portado de la referencia. Cambios:
  - `<Panel position="bottom-center" className="mb-4!">`.
  - Ancho `w-[560px]` con un `max-width` en `style`, calculado como `calc(100% - ${2 * MINIMAP_WIDTH + 64}px)` (`MINIMAP_WIDTH` de `@/features/canvas/theme`). El `IdeDock` (abajo-izq.) y el minimapa + zoom (abajo-der.) ocupan como mucho eso por lado, así que la barra **no se solapa** con ellos. Si no cabe, deja que las filas hagan `flex-wrap`; no ocultes controles.
  - Borra los `Toggle` de "Mostrar cada paso en el IDE" y "La cámara sigue el flujo", y el componente `Toggle` si queda sin uso. Conserva el toggle "Panel de pasos" (abre/cierra el cajón en `"flow"`).
  - Velocidades desde `SPEEDS`, que ya son 3.
  - Controles finales: selector de escenario, anterior, play/pausa/repetir, siguiente, velocidad, panel de pasos, **salir** (`Square`, llama a `stopSimulation`), barra de progreso y "Paso N / M · título".
- `web/src/features/simulation/components/SimulateButton.tsx`: cópialo de la referencia.

**Modificar**

- `web/src/features/canvas/CanvasView.tsx`: añade `<PlayerBar />` dentro de `<ReactFlow>`.
- `web/src/features/canvas/components/AppHeader.tsx`: añade `<SimulateButton />` justo antes del botón "Exportar arquitectura". Muéstralo solo si la vista es `architecture`.

**Checkpoint**
- `npm run typecheck` y `npm test` en verde.
- Visual (ventana de 1280 px con el cajón abierto): la barra no tapa el `IdeDock`, el minimapa ni el zoom.
- Teclado: Espacio pausa/reanuda, ← y → cambian de paso, y **el foco queda en el botón play** tras pulsar "Simular flujo" (si no, Espacio vuelve a pulsar la cabecera y la para).
- "Salir" deja `status === "idle"`, quita el atenuado y la barra desaparece.
- Sin `public/scenarios/<grafo>.json` (prueba con `?graph=` apuntando a otro grafo): el botón sale desactivado con su tooltip y no hay errores en la consola.

---

## 8.6 Pestaña "Flujo" en el cajón: función, archivo, línea e Input/Output

**Crear**

- `web/src/features/simulation/components/PayloadPair.tsx`: cópialo de la referencia.
- `web/src/features/drawer/FlowTab.tsx`, portado de la referencia. `onOpenInIde` usa `allowDeepLink: true`: es un clic explícito.

**Modificar**

- `web/src/features/canvas/store.ts`: `export type DrawerTab = "code" | "lesson" | "impact" | "flow";`.
- `web/src/features/simulation/lib/actions.ts`: descomenta el `openDrawer(null, "flow")` del `TODO 8.6`.
- `web/src/features/drawer/StepTimeline.tsx`, dos props **opcionales** que no cambian la lección actual:
  - `label?: string`, que sustituye al `aria-label="Pasos de la lección"` fijo (con ese texto como valor por defecto).
  - `renderDetail?: (index: number) => ReactNode`, que se pinta dentro de la tarjeta del paso activo, después de `connectionReason`.
- `web/src/features/drawer/TeacherDrawer.tsx`:
  - Añade `{ id: "flow", label: "Flujo" }` a `TABS`, pero **renderízalo solo si** `useSimStore((s) => s.scenarios.length) > 0`.
  - Renderiza `<FlowTab />` cuando `tab === "flow"`. No depende de `codeModule`.
  - Cabecera: cuando `tab === "flow"` y hay escenario activo, muestra el módulo del paso actual (`scenario.steps[stepIndex].nodeId` → `indexes.modulesById`) en lugar de "Selecciona un componente del lienzo". **No** cambies `drawer.moduleId` en cada paso: el efecto `fitView` del cajón pelearía con la cámara del puente.

**Checkpoint**
- `npm run typecheck` y `npm test` en verde.
- Sin simulación, la pestaña "Flujo" lista los escenarios con "N pasos · ≈ X s" y un botón "Simular".
- Durante la simulación, el paso activo muestra título, descripción, `ruta · L{inicio}–{fin} · función`, "Ver en el IDE" y las tablas **Input** y **Output**. Al cambiar de paso con la barra, el cajón lo sigue.
- La lección normal (pestaña "Lección") se ve exactamente igual que antes.

---

## Informe final

Entrega una tabla con cada criterio de checkpoint de 8.1–8.6: **✅ verificado** (con el comando o la observación), **❌ falla** (con el error) o **👁 requiere verificación humana**. Incluye la salida final de `npm test` (número de tests) y la lista de archivos creados y modificados.
