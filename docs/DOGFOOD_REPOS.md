# Dogfood: matriz de repos de prueba

Lista fija de repos para comprobar, después de cada cambio en import, lienzo o tutor, que el producto sigue
diciendo la verdad. No es una feature: es una rutina para no engañarnos. **Objetivo: la matriz completa en menos de 1 h**
(≈ 5 min por repo).

Todo se hace en la web (`cd web && npm run dev`), en una ventana normal (no privada: la persistencia usa IndexedDB).

## Los repos

| # | Caso | Repo / origen | Qué pone a prueba |
|---|---|---|---|
| 1 | API TypeScript | `gothinkster/node-express-realworld-example-app` | Express + Prisma: rutas, servicios, datos |
| 2 | App Next.js | `vercel/commerce` | App Router, `page`/`layout`/`route` como entrypoints |
| 3 | FastAPI full-stack | `fastapi/full-stack-fastapi-template` | Python + frontend TS en el mismo repo |
| 4 | RAG en Python | `zylon-ai/private-gpt` | Subsistemas de IA (ingesta, embeddings, LLM) |
| 5 | Microservicios poliglota | `GoogleCloudPlatform/microservices-demo` | Go/Java/Python/Node + contratos `.proto` (gRPC) |
| 6 | Monorepo grande | `react/react` (antes `facebook/react`) | Más de 400 fuentes: el ranker decide qué entra |
| 7 | Monorepo truncado | `microsoft/TypeScript` | Árbol truncado por GitHub (comprobado el 2026-09-27) + tope: el banner debe avisarlo |
| 8 | Go (heurístico) | `gin-gonic/gin` | Escaneo heurístico de Go |
| 9 | Java (heurístico) | `spring-projects/spring-petclinic` | Escaneo heurístico de Java/Spring |
| 10 | Carpeta local pequeña | `sandbox/` de este repo (pestaña «Archivos locales») | Menos de 12 módulos: se salta Level 0 |

> Falta un repo de eventos con Kafka en la lista. Si el equipo tiene uno pequeño y público de referencia, que sustituya al #5
> o se añada como #11. Repos públicos de terceros: si alguno cambia de nombre o se archiva, se sustituye aquí y se anota
> en el registro.

## Cómo pasar cada repo

1. **Import.** En Pipelines, pega el repo en «Understand any repository» → «Map it» (o desde la landing `/`). Sin token.
   Solo si GitHub lo pide (límite de peticiones), añade un PAT y anótalo.
2. **Cobertura.** Lee el banner de arriba a la izquierda del lienzo: analizados, fuera del tope, demasiado grandes, árbol truncado.
3. **Level 0.** El lienzo abre con 4–8 bloques. Clic en uno, luego «← Arquitectura».
4. **Tutor.** En el panel lateral, sobre el proyecto entero:
   - **Pregunta de ubicación:** «¿Dónde empieza una petición / se arranca la app?».
   - **Pregunta trampa:** «¿Dónde se configura el cliente de Kafka?» (en el #5, «¿Dónde se procesan los pagos con Stripe?»).
5. **Recarga.** F5 en el lienzo.

## Checklist por repo

Marca cada celda con ✅ (bien), ⚠️ (funciona pero engaña o chirría: anota por qué) o ❌ (roto).

| Check | Criterio de ✅ |
|---|---|
| **Import sin PAT** | Termina sin pedir token (salvo límite de GitHub, que el modal explica) |
| **Cobertura honesta** | El banner cuadra con el repo: si hay más de 400 fuentes dice «mapa parcial»; en el #7 menciona el árbol truncado |
| **Entrypoints dentro** | En «Ver todos los módulos» aparecen los `main`/`app`/`server`/`index` que un humano señalaría |
| **L0 reconocible** | 4–8 bloques cuyos nombres un desarrollador del repo reconocería; «Otros» no es el bloque más grande |
| **Drill-down** | Clic → solo los módulos del bloque; «← Arquitectura» vuelve; el encuadre se ajusta |
| **Tutor cita bien** | La respuesta de ubicación trae al menos una cita `ruta:línea` azul (válida) que abre el sitio correcto |
| **Tutor admite** | La pregunta trampa responde «no aparece en el mapa» (nota gris) o sale con el aviso ámbar «Sin evidencia», nunca una ruta inventada sin aviso |
| **F5 conserva** | Tras recargar, el mismo grafo sin volver a importar |
| **Tiempo a L0** | Anota los ms (ver «Métricas locales»); sirve para ver tendencias, no hay umbral |

En el #10 el criterio de **L0** se invierte: debe abrir **directo** en el detalle, sin bloques.

## Métricas locales

Cada import y el tiempo desde «Importar» hasta ver Level 0 se cuentan en `localStorage` de tu navegador
(`web/src/lib/metrics/localMetrics.ts`). Nada sale del navegador. Para leerlas, en la consola:

```js
JSON.parse(localStorage.getItem("teacher:local-metrics"))
// { importsStarted, importsCompleted, importsFailed, timeToLevel0Ms: [ … últimas 20 … ] }
```

En desarrollo, el lienzo también escribe `[teacher] import → Level 0 en N ms` en la consola.
Para empezar una pasada limpia: `localStorage.removeItem("teacher:local-metrics")`.

## Registro de pasadas

Una fila por pasada. En «Hallazgos», enlaza el ticket de cada ⚠️/❌.

| Fecha | Tras sección / cambio | Quién | ✅ / ⚠️ / ❌ | Mediana tiempo a L0 | Hallazgos |
|---|---|---|---|---|---|
| | | | | | |
