# Referencia del Ticket 8 (Simular flujo): estado real

Esta carpeta es **material de origen**, no un plan. El plan de ejecución es `docs/tickets/TICKET-8.md`.
Lo que hay aquí se escribió por partes y **no todo sigue siendo válido para el lienzo actual** (por capas,
con subsistemas). Léelo con esta tabla.

## Válido y verificado contra el código actual

Comprobado sobre una copia del repo con el layout por capas (`prepareGraph` + `layeredFlow`):
`npm run scenarios:build` y `scenarios:validate` en verde, JSON determinista, **61 tests** (`lib/*.test.ts` +
`store.test.ts`) y `tsc` sin errores.

| Archivo | Nota |
|---|---|
| `core/src/simulation.ts` | Tipos exactos a los pedidos (`FlowStep`, `ExecutionFlowScenario`) + `ScenarioFile`. |
| `web/src/features/simulation/lib/{route,timeline,engine,visuals,payload,scenario,stepView}.ts` (+ tests) | Lógica pura sin React. |
| `web/src/features/simulation/lib/drawnEdges.ts` | **Nuevo.** `drawnGraph(graph)` = módulos visibles + aristas de `layeredFlow`. Es contra lo que hay que validar y enrutar. |
| `web/src/features/simulation/store.ts` (+ `store.test.ts`) | Estado de zustand con el motor **fuera** de React. |
| `web/scripts/build-sandbox-scenarios.ts`, `validate-scenarios.ts` | Ya validan contra `drawnGraph`. Las aristas de Embedder y Vector Store usan ids `imports:…`. |
| `web/public/scenarios/macro_rag_project.json` | Salida actual del script (sin aristas `support:` de Embedder/Vector Store). |

## Por qué existe `drawnEdges.ts` (el error que hubo)

Una versión anterior de esta referencia validaba los escenarios contra `graphToFlow(graph)` sin capas. Ahí
Embedder y Vector Store son sub-nodos de RAG Pipeline y tienen aristas `support:…`. **En el lienzo real no:**
`prepareGraph` los promueve a tarjeta (están en una capa anterior a su padre), así que solo se dibuja una arista
`support:` (`service → prompts`) y las demás son `imports:…`, orientadas por `layeredFlow` (p. ej. embeddings →
pipeline, al revés que el import). Con las aristas antiguas, 2 pasos de "Responder una pregunta" eran inválidos
en la app y el botón **Simular flujo** habría salido desactivado.

Regla: **nunca valides ni enrutes contra `graph.edges` ni contra `graphToFlow`; usa `drawnGraph`.**

## Obsoleto: no lo uses con el lienzo actual

| Archivo | Por qué |
|---|---|
| `apply-integration-patches.ps1` | Codifica un diseño anterior (selectores de simulación dentro de cada nodo, reproductor arriba, 4×, toggles de IDE/cámara) y se escribió antes de los subsistemas. `TICKET-8.md` describe otro diseño (estado pintado desde `CanvasShell`, reproductor abajo, 3 velocidades, IDE/cámara siempre activos). El script se niega a ejecutarse salvo `-Force`. |
| `web/src/features/simulation/components/PlayerBar.tsx`, `SimulationBridge.tsx`, `store.ts` (partes) | Contienen los toggles `syncIde` / `followCamera`, la velocidad 4× y el reproductor **arriba**. `TICKET-8.md` indica exactamente qué cambiar al portarlos. |
| `web/src/features/canvas/edges/SupportEdge.tsx`, `nodes` (en el script) | Siguen siendo válidos como pieza; el cableado depende de la decisión de `TICKET-8.md` sobre cómo llega el estado a los nodos. |

Los detalles de diseño de interfaz (posición del reproductor, velocidades, toggles) **los decide `TICKET-8.md`**.
