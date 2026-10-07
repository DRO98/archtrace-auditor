# Simulación de flujo ("Trazabilidad de ejecución")

El botón **Simular flujo** de la cabecera reproduce un *escenario*: una secuencia de pasos que recorre los
componentes del lienzo. Un paquete de datos viaja por las aristas, el nodo activo se ilumina, el IDE salta al
código de cada paso y el panel lateral (pestaña **Flujo**) explica cada paso con su dato de entrada y de salida.

> Los datos de entrada y salida (`mockPayload`) son **ejemplos ilustrativos**, no capturas de una ejecución real.
> La interfaz lo indica bajo cada paso.

El plan de implementación es `docs/tickets/TICKET-8.md`; el material de origen, `docs/tickets/ticket-8-reference/`
(léase su `README.md`: indica qué partes son válidas y cuáles están obsoletas).

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Tipos (`FlowStep`, `ExecutionFlowScenario`, `ScenarioFile`) | `core/src/simulation.ts` |
| Escenarios de un proyecto | `web/public/scenarios/<grafo>.json` (mismo nombre que `web/public/graphs/<grafo>.json`) |
| Definiciones del sandbox (fuente de los JSON) | `web/scripts/build-sandbox-scenarios.ts` |
| Grafo y aristas **tal como se dibujan** | `web/src/features/simulation/lib/drawnEdges.ts` (`drawnGraph`) |
| Validador estricto contra ese grafo | `web/src/features/simulation/lib/scenario.ts` |
| Motor de tiempo (sin React) | `web/src/features/simulation/lib/{timeline,engine}.ts` |
| Rutas del paquete por las aristas | `web/src/features/simulation/lib/route.ts` |
| Estado visual de nodos y aristas | `web/src/features/simulation/lib/visuals.ts` |
| Estado global | `web/src/features/simulation/store.ts` |
| Métricas RAG agregadas y tarjeta "Métricas del Flujo" | `web/src/features/simulation/lib/metrics.ts`, `components/FlowMetricsCard.tsx` |

## Comandos (desde `web/`)

```
npm run scenarios:build      # genera public/scenarios/macro_rag_project.json (determinista)
npm run scenarios:validate   # valida los JSON contra el lienzo real y comprueba que todo paso tiene camino
npm test
```

## Regla de oro: valida contra lo que se dibuja

El lienzo actual es **por capas**: `prepareGraph` oculta los módulos aislados y **promueve a tarjeta** los sub-nodos
que quedan en una capa anterior a su padre, y `layeredFlow` **orienta** las aristas en el sentido del flujo.
Consecuencias para los escenarios:

- `nodeId` debe ser un módulo **visible** (no uno de los ocultos).
- `edgeIdToNext` debe ser una arista **dibujada**. En el sandbox, Embedder y Vector Store son tarjetas: sus aristas
  son `imports:src/rag/pipeline.py:src/rag/embeddings.py` e `imports:src/rag/pipeline.py:src/rag/vector_store.py`
  (dibujadas embeddings → pipeline y vector_store → pipeline). Solo queda una arista `support:` dibujada
  (`support:src/llm/service.py:src/llm/prompts.py`).
- El id de la arista no cambia con la orientación; `route.ts` calcula el sentido del viaje (`reversed`).

Por eso **no** se valida contra `graph.edges` ni contra `graphToFlow`: siempre contra `drawnGraph(graph)`.

## Cómo añadir o editar un escenario del sandbox

1. Abre `web/scripts/build-sandbox-scenarios.ts` y añade un objeto a `DEFS` (o edita uno).
2. Cada paso indica `nodeId` (el `filePath` del módulo) y `functionName` **tal como aparece en el grafo**
   (`ingest_document`, `RagPipeline.ingest`, `VectorStore.search`…).
3. **No escribas números de línea.** El script los lee del grafo, así son siempre exactos. Si el nombre no existe
   en el módulo, el script falla y dice cuál.
4. `edgeIdToNext` es opcional. Úsalo para fijar la arista entre este paso y el siguiente. Si falta, el paquete sigue
   el camino más corto entre ambos nodos, pasando por otros nodos si hace falta (de Chunker a Embedder pasa por
   RAG Pipeline).
5. Ejecuta `npm run scenarios:build` y `npm run scenarios:validate`.

## Reglas que el validador exige

- `stepIndex` es 0-based y coincide con la posición del paso. `entryNodeId` es el nodo del primer paso.
- `fileReference.path` es el archivo del nodo; `functionName` existe en él; `lineStart`/`lineEnd` coinciden
  **exactamente** con ese bloque de código.
- `edgeIdToNext` es una arista dibujada que conecta el nodo del paso con el del siguiente (en cualquier sentido)
  y no puede estar en el último paso.
- `durationMs` (opcional) es un entero entre 300 y 15000. Por defecto un paso dura 2000 ms a velocidad 1×.
- `mockPayload.input/output` son texto u objeto, de menos de 4000 caracteres.
- `metrics` (opcional) son métricas RAG **ilustrativas** del paso:
  `{ latencyMs, tokenCount: { prompt, generation }, contextScore }`. `latencyMs` ≥ 0, los tokens son enteros ≥ 0
  y `contextScore` está entre 0 y 1. Los escenarios sin `metrics` siguen siendo válidos.
- `description` tiene como máximo 400 caracteres. Escríbela para alguien que **no** sabe programar: 2–3 frases,
  sin nombres de variables, con una analogía si ayuda.

## Cómo se comporta el motor

- **Tiempos a 1×:** cada paso dura `durationMs` (2000 ms por defecto); cada salto del paquete por una arista, 700 ms;
  si no hay camino, una pausa de 250 ms. Dos pasos seguidos en el mismo nodo no tienen viaje entre ellos.
  Con los escenarios del sandbox: "Guardar un documento" 14 200 ms y "Responder una pregunta" 18 200 ms.
- **Siguiente:** anima el viaje y se detiene al empezar el paso siguiente. En el último paso, termina.
- **Anterior:** si el paso lleva más de medio segundo en marcha, vuelve al inicio de ese paso; si no, al anterior.
- Con `prefers-reduced-motion`, el viaje del paquete dura 0 (los pasos saltan).
- Las velocidades disponibles, la posición del reproductor y si el IDE y la cámara siguen el flujo son decisiones de
  interfaz que fija `TICKET-8.md`.

## Ideas para más adelante (fuera del alcance actual)

- Que la IA genere escenarios (`ExecutionFlowScenario`) con el mismo pipeline de lecciones y que pasen por
  `parseScenarioFile` antes de mostrarse.
- Trazas de ejecución reales en lugar de payloads de ejemplo.
- Ramas y condicionales (hoy los pasos son una secuencia lineal).

## Métricas del Flujo

Si algún paso declara `metrics`, la pestaña **Flujo** muestra encima de los pasos la tarjeta **Métricas del Flujo**:
latencia total (suma de los pasos) y del paso activo, tokens de prompt y de generación (sumados) y la relevancia
media del contexto (media de los pasos con métricas). En el detalle de cada paso aparece además un chip compacto
con sus propias métricas.

Colores: latencia verde ≤150 ms, amarilla ≤500 ms, roja >500 ms; contexto verde ≥0.7, amarillo ≥0.4, rojo <0.4.
En el sandbox los valores se definen en `build-sandbox-scenarios.ts` (función `metrics(...)` de cada paso).
