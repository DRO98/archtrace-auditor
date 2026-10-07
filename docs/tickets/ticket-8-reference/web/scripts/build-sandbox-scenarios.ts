import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodeGraph } from "@core/graph";
import type { ExecutionFlowScenario, FlowStep, ScenarioFile } from "@core/simulation";
import { parseCodeGraph } from "../src/features/canvas/lib/graph";
import { drawnGraph } from "../src/features/simulation/lib/drawnEdges";
import { parseScenarioFile } from "../src/features/simulation/lib/scenario";

/**
 * Genera `public/scenarios/macro_rag_project.json` a partir de definiciones compactas.
 * Los rangos de líneas NO se escriben a mano: se leen del grafo, para que sean exactos.
 * Los payloads son ilustrativos (no salen de una ejecución real).
 */

const ROUTES = "src/api/routes.py";
const PIPELINE = "src/rag/pipeline.py";
const CHUNKER = "src/rag/chunker.py";
const EMBEDDER = "src/rag/embeddings.py";
const STORE = "src/rag/vector_store.py";
const LLM = "src/llm/service.py";

// Ids de las aristas TAL COMO SE DIBUJAN en el lienzo por capas. En él, Embedder y Vector Store son
// tarjetas (no sub-nodos): sus aristas son `imports:` (dibujadas embeddings → pipeline y
// vector_store → pipeline, es decir, al revés que el import). El id no cambia; `route.ts`
// resuelve el sentido del viaje. Solo queda una arista `support:` dibujada (service → prompts).
const E_ROUTES_PIPELINE = `imports:${ROUTES}:${PIPELINE}`;
const E_PIPELINE_CHUNKER = `imports:${PIPELINE}:${CHUNKER}`;
const E_PIPELINE_LLM = `imports:${PIPELINE}:${LLM}`;
const E_PIPELINE_EMBEDDER = `imports:${PIPELINE}:${EMBEDDER}`;
const E_PIPELINE_STORE = `imports:${PIPELINE}:${STORE}`;

interface StepDef {
  nodeId: string;
  functionName: string;
  title: string;
  description: string;
  input: Record<string, unknown> | string;
  output: Record<string, unknown> | string;
  edgeIdToNext?: string;
  durationMs?: number;
}

interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  steps: StepDef[];
}

const VECTOR = [0, 0.14, 0, 0.29, 0.07, 0, 0.21, 0.29];
const DOC_TEXT = "TeacherCanvas explica código con rutas guiadas paso a paso.";

const DEFS: ScenarioDef[] = [
  {
    id: "ingest-document",
    name: "Guardar un documento",
    description:
      "Qué ocurre desde que llega un documento nuevo hasta que queda guardado y listo para responder preguntas.",
    steps: [
      {
        nodeId: ROUTES,
        functionName: "ingest_document",
        title: "Llega un documento nuevo",
        description:
          "La puerta de entrada de la aplicación recibe el título y el texto de un documento. Lo primero que hace es inventar un nombre corto y único (un «identificador») para poder encontrarlo después.",
        input: { title: "Guía de bienvenida", body: DOC_TEXT },
        output: { document_id: "guia-de-bienvenida", body: DOC_TEXT },
        edgeIdToNext: E_ROUTES_PIPELINE,
      },
      {
        nodeId: PIPELINE,
        functionName: "RagPipeline.ingest",
        title: "El coordinador toma el mando",
        description:
          "Este componente dirige la ingesta: pide partir el texto, convertir cada trozo en números y guardarlo. Por sí mismo no hace el trabajo pesado; reparte tareas entre los demás.",
        input: { document_id: "guia-de-bienvenida", text: DOC_TEXT },
        output: { text: DOC_TEXT, size: 240 },
        edgeIdToNext: E_PIPELINE_CHUNKER,
      },
      {
        nodeId: CHUNKER,
        functionName: "chunk_text",
        title: "El texto se parte en trozos",
        description:
          "Los textos largos se cortan en trozos pequeños que se solapan un poco. Así cada trozo cabe en la memoria del modelo y no se pierde el contexto en los cortes.",
        input: { text: DOC_TEXT, size: 240, overlap: 40 },
        output: { chunks: [DOC_TEXT] },
      },
      {
        nodeId: EMBEDDER,
        functionName: "Embedder.embed",
        title: "Cada trozo se convierte en números",
        description:
          "Un ordenador no entiende frases, pero sí números. Este componente transforma cada trozo en una lista de números (un «vector») que representa su contenido. Este paso se repite por cada trozo.",
        input: DOC_TEXT,
        output: { dimensions: 32, vector: VECTOR },
      },
      {
        nodeId: STORE,
        functionName: "VectorStore.upsert",
        title: "Se guarda en la base vectorial",
        description:
          "La lista de números se guarda junto con el texto original, como una ficha en un archivador. Más tarde servirá para encontrar textos parecidos a una pregunta.",
        input: { record_id: "guia-de-bienvenida:0", values: VECTOR, source: "guia-de-bienvenida" },
        output: { stored: true, total_records: 1 },
      },
    ],
  },
  {
    id: "answer-question",
    name: "Responder una pregunta",
    description:
      "El recorrido completo de una pregunta: cómo se buscan pistas en lo guardado y cómo se redacta la respuesta.",
    steps: [
      {
        nodeId: ROUTES,
        functionName: "ask_question",
        title: "Llega una pregunta",
        description:
          "El usuario escribe una pregunta. La puerta de entrada la limpia (quita espacios de más) y se la pasa al coordinador para que busque información.",
        input: { question: "  ¿Qué hace   TeacherCanvas? " },
        output: { question: "¿Qué hace TeacherCanvas?" },
        edgeIdToNext: E_ROUTES_PIPELINE,
      },
      {
        nodeId: PIPELINE,
        functionName: "RagPipeline.retrieve",
        title: "El coordinador busca pistas",
        description:
          "Antes de responder hay que encontrar qué partes de los documentos guardados se parecen a la pregunta. El coordinador pide ayuda a otros dos componentes.",
        input: { question: "¿Qué hace TeacherCanvas?", limit: 4 },
        output: { text: "¿Qué hace TeacherCanvas?" },
        edgeIdToNext: E_PIPELINE_EMBEDDER,
      },
      {
        nodeId: EMBEDDER,
        functionName: "Embedder.embed",
        title: "La pregunta también se convierte en números",
        description:
          "La pregunta pasa por el mismo «traductor a números» que usaron los documentos. Así se pueden comparar en igualdad de condiciones.",
        input: "¿Qué hace TeacherCanvas?",
        output: { dimensions: 32, vector: VECTOR },
      },
      {
        nodeId: STORE,
        functionName: "VectorStore.search",
        title: "Se buscan los textos más parecidos",
        description:
          "La base vectorial compara los números de la pregunta con los de cada trozo guardado y se queda con los más parecidos. Es como buscar en un archivador por parecido y no por título.",
        input: { query: VECTOR, limit: 4 },
        output: { hits: [{ text: DOC_TEXT, score: 0.83 }, { text: "Otro fragmento menos relacionado.", score: 0.41 }] },
        edgeIdToNext: E_PIPELINE_STORE,
      },
      {
        nodeId: PIPELINE,
        functionName: "RagPipeline.answer",
        title: "Se prepara el mensaje para la IA",
        description:
          "Con los textos encontrados se arma un mensaje: la pregunta más el material de apoyo. Es como darle a un experto los apuntes justos antes de preguntarle.",
        input: { question: "¿Qué hace TeacherCanvas?", context: `(0.83) ${DOC_TEXT}` },
        output: { prompt: `Question: ¿Qué hace TeacherCanvas?\nContext:\n(0.83) ${DOC_TEXT}` },
        edgeIdToNext: E_PIPELINE_LLM,
      },
      {
        nodeId: LLM,
        functionName: "LlmService.complete",
        title: "El modelo redacta la respuesta",
        description:
          "El modelo de lenguaje recibe el mensaje y escribe la respuesta. En este proyecto de ejemplo es un modelo de juguete que solo repite parte del mensaje; en una aplicación real aquí estaría una IA como Claude o GPT.",
        input: { prompt: `Question: ¿Qué hace TeacherCanvas?\nContext:\n(0.83) ${DOC_TEXT}` },
        output: `[sandbox] 96 chars :: Question: ¿Qué hace TeacherCanvas? Context: (0.83) ${DOC_TEXT}`,
      },
      {
        nodeId: LLM,
        functionName: "stream_tokens",
        title: "La respuesta llega palabra a palabra",
        description:
          "La respuesta se trocea en palabras para mostrarla poco a poco en pantalla, como cuando alguien escribe en directo. Al final, la API devuelve el texto completo al usuario.",
        input: "[sandbox] 96 chars :: Question: ¿Qué hace TeacherCanvas? …",
        output: { tokens: ["[sandbox] ", "96 ", "chars ", ":: ", "Question: ", "…"] },
      },
    ],
  },
];

function buildScenario(def: ScenarioDef, graph: CodeGraph): ExecutionFlowScenario {
  const modules = new Map(graph.modules.map((item) => [item.id, item]));
  const steps: FlowStep[] = def.steps.map((step, index) => {
    const owner = modules.get(step.nodeId);
    if (!owner) throw new Error(`${def.id} · paso ${index}: no existe el módulo ${step.nodeId}`);
    const block = owner.subBlocks.find((item) => item.name === step.functionName);
    if (!block) throw new Error(`${def.id} · paso ${index}: no existe ${step.functionName} en ${step.nodeId}`);
    const built: FlowStep = {
      stepIndex: index,
      nodeId: step.nodeId,
      title: step.title,
      description: step.description,
      fileReference: {
        path: owner.filePath,
        lineStart: block.range.startLine,
        lineEnd: block.range.endLine,
        functionName: block.name,
      },
      mockPayload: { input: step.input, output: step.output },
    };
    if (step.edgeIdToNext !== undefined) built.edgeIdToNext = step.edgeIdToNext;
    if (step.durationMs !== undefined) built.durationMs = step.durationMs;
    return built;
  });
  const first = steps[0];
  if (!first) throw new Error(`${def.id}: sin pasos`);
  return { id: def.id, name: def.name, description: def.description, entryNodeId: first.nodeId, steps };
}

function main(): void {
  const graphName = "macro_rag_project";
  const graphPath = path.resolve(process.cwd(), "public/graphs", `${graphName}.json`);
  const parsed = parseCodeGraph(JSON.parse(readFileSync(graphPath, "utf8")) as unknown);
  if (!parsed.ok) throw new Error(`Grafo inválido:\n${parsed.errors.join("\n")}`);

  // Se construye y se valida contra lo que REALMENTE se dibuja (módulos visibles + aristas de layeredFlow).
  const drawn = drawnGraph(parsed.graph);
  const file: ScenarioFile = {
    version: 1,
    graph: graphName,
    scenarios: DEFS.map((def) => buildScenario(def, drawn.graph)),
  };

  const check = parseScenarioFile(JSON.parse(JSON.stringify(file)) as unknown, drawn.graph, drawn.edges);
  if (!check.ok) throw new Error(`Escenarios inválidos:\n${check.errors.join("\n")}`);

  const outDir = path.resolve(process.cwd(), "public/scenarios");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${graphName}.json`);
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  console.info(`Escenarios escritos en ${path.relative(process.cwd(), outPath)}: ${file.scenarios.length}`);
}

main();
