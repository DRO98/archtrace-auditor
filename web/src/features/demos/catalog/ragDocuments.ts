import type { CodeGraph } from "@core/graph";
import { buildModule, buildSteps, edge, metrics } from "../lib/build";
import type { DemoDefinition } from "../types";

const ROUTES = "app/api/routes.py";
const LOADER = "app/rag/loader.py";
const CHUNKER = "app/rag/chunker.py";
const EMBEDDER = "app/rag/embedder.py";
const STORE = "app/rag/vector_store.py";
const PIPELINE = "app/rag/pipeline.py";
const PROMPTS = "app/llm/prompts.py";
const OLLAMA = "app/llm/ollama_client.py";

const graph: CodeGraph = {
  version: 1,
  projectName: "Demo · RAG de Documentos",
  groups: [
    { id: "api", label: "API", color: "sky" },
    { id: "rag", label: "RAG", color: "violet" },
    { id: "llm", label: "LLM local", color: "amber" },
  ],
  subsystems: [
    { id: "rag-core", label: "RAG Core · Ingesta y búsqueda", color: "violet" },
    { id: "inference", label: "Inferencia · Llama3 (Ollama)", color: "amber" },
  ],
  modules: [
    buildModule({
      id: ROUTES,
      label: "API Routes",
      groupId: "api",
      role: "api",
      layer: 0,
      summary: "Endpoints FastAPI: subir un PDF y hacer preguntas sobre los documentos indexados.",
      blocks: [
        ["upload_document", 14, 29, "POST /documents: recibe el PDF y lanza la ingesta."],
        ["ask", 32, 51, "POST /ask: responde una pregunta con contexto recuperado."],
      ],
    }),
    buildModule({
      id: PIPELINE,
      label: "RAG Pipeline",
      groupId: "rag",
      role: "pipeline",
      layer: 3,
      summary: "Orquesta la ingesta (cargar → trocear → vectorizar → indexar) y la respuesta (buscar → prompt → generar).",
      blocks: [
        ["RagPipeline", 12, 78],
        ["RagPipeline.ingest", 20, 41, "Carga, trocea, vectoriza e indexa un documento."],
        ["RagPipeline.answer", 43, 76, "Recupera los k trozos más parecidos y genera la respuesta."],
      ],
    }),
    buildModule({
      id: LOADER,
      label: "PDF Loader",
      groupId: "rag",
      role: "transform",
      layer: 1,
      subsystem: "rag-core",
      summary: "Extrae el texto de cada página del PDF conservando el número de página como metadato.",
      blocks: [["load_pdf", 9, 33, "Devuelve una lista de páginas {page, text}."]],
    }),
    buildModule({
      id: CHUNKER,
      label: "Text Chunker",
      groupId: "rag",
      role: "transform",
      layer: 1,
      subsystem: "rag-core",
      summary: "Parte el texto en trozos de ~500 tokens con 50 de solape para no cortar ideas por la mitad.",
      blocks: [["split_text", 7, 31, "Ventana deslizante por tokens con solape."]],
    }),
    buildModule({
      id: EMBEDDER,
      label: "Embedder",
      groupId: "rag",
      role: "ai-model",
      layer: 2,
      subsystem: "rag-core",
      summary: "Convierte texto en vectores de 768 dimensiones con nomic-embed-text servido por Ollama.",
      blocks: [["embed_texts", 11, 34, "Llama a /api/embeddings en lotes de 32."]],
    }),
    buildModule({
      id: STORE,
      label: "Vector Store",
      groupId: "rag",
      role: "database",
      layer: 2,
      subsystem: "rag-core",
      summary: "Índice vectorial (Chroma) persistido en disco: guarda trozos con metadatos y busca por similitud coseno.",
      blocks: [
        ["VectorStore", 8, 62],
        ["VectorStore.upsert", 21, 37, "Inserta o reemplaza trozos por id."],
        ["VectorStore.search", 39, 60, "Top-k por similitud coseno."],
      ],
    }),
    buildModule({
      id: OLLAMA,
      label: "Ollama Client",
      groupId: "llm",
      role: "ai-model",
      layer: 4,
      subsystem: "inference",
      summary: "Cliente HTTP de Ollama: genera la respuesta con llama3:8b en local, sin API key.",
      blocks: [
        ["OllamaClient", 9, 55],
        ["OllamaClient.generate", 22, 53, "POST /api/generate con temperatura 0.2."],
      ],
    }),
    buildModule({
      id: PROMPTS,
      label: "Prompt Builder",
      groupId: "llm",
      role: "prompt",
      layer: 4,
      subsystem: "inference",
      supportOf: OLLAMA,
      summary: "Plantilla que inyecta los trozos recuperados y obliga a citar la página de origen.",
      blocks: [["build_prompt", 5, 27, "Sistema + contexto numerado + pregunta."]],
    }),
  ],
  edges: [
    edge(ROUTES, PIPELINE),
    edge(PIPELINE, LOADER),
    edge(PIPELINE, CHUNKER),
    edge(PIPELINE, EMBEDDER),
    edge(PIPELINE, STORE),
    edge(PIPELINE, OLLAMA),
    edge(OLLAMA, PROMPTS),
  ],
};

const QUESTION = "¿Cuántos días de vacaciones tengo el primer año?";
const CHUNK_A = "Política de vacaciones (pág. 4): durante el primer año, cada persona empleada disfruta de 22 días laborables, que se generan a razón de 1,83 días por mes trabajado.";
const CHUNK_B = "Pág. 5: los días no disfrutados pueden trasladarse hasta el 31 de marzo del año siguiente, con un máximo de 5 días.";
const CHUNK_C = "Pág. 2: el periodo de prueba es de 6 meses; durante ese tiempo las vacaciones se generan igual que el resto del año.";

export const RAG_DOCUMENTS_DEMO: DemoDefinition = {
  graphName: "demo_rag_documents",
  title: "RAG de Documentos",
  tagline: "Llama3 + Vector Store: pregunta a un PDF interno",
  graph,
  scenarios: {
    version: 1,
    graph: "demo_rag_documents",
    scenarios: [
      {
        id: "ask-question",
        name: "Responder una pregunta",
        description: "Desde que llega la pregunta hasta que Llama3 responde citando la página del manual.",
        entryNodeId: ROUTES,
        steps: buildSteps(graph, [
          {
            nodeId: ROUTES,
            block: "ask",
            title: "Llega la pregunta",
            description: "El endpoint /ask valida la petición y se la pasa al pipeline.",
            input: { question: QUESTION, top_k: 3 },
            output: { question: QUESTION, top_k: 3 },
            metrics: metrics(4),
          },
          {
            nodeId: PIPELINE,
            block: "RagPipeline.answer",
            title: "El pipeline coordina",
            description: "Primero hay que convertir la pregunta al mismo espacio vectorial que los documentos.",
            input: { question: QUESTION },
            output: { step: "embed_query" },
            metrics: metrics(1),
          },
          {
            nodeId: EMBEDDER,
            block: "embed_texts",
            title: "La pregunta se vuelve un vector",
            description: "nomic-embed-text convierte la pregunta en 768 números que capturan su significado.",
            input: { texts: [QUESTION], model: "nomic-embed-text" },
            output: { vectors: [[0.021, -0.113, 0.087, "… 765 más"]], dims: 768 },
            metrics: metrics(38, 12, 0),
          },
          {
            nodeId: STORE,
            block: "VectorStore.search",
            title: "Se buscan los trozos más parecidos",
            description: "El vector store compara el vector con todos los trozos indexados y devuelve los 3 más cercanos.",
            input: { k: 3, metric: "cosine" },
            output: { hits: [{ id: "manual.pdf#p4-1", score: 0.91 }, { id: "manual.pdf#p5-2", score: 0.78 }, { id: "manual.pdf#p2-3", score: 0.64 }] },
            metrics: metrics(6, 0, 0, 0.91),
          },
          {
            nodeId: PROMPTS,
            block: "build_prompt",
            title: "Se arma el prompt",
            description: "Los trozos recuperados se numeran y se insertan como contexto junto a la pregunta.",
            input: { chunks: 3, question: QUESTION },
            output: "Responde SOLO con el contexto. Cita la página.\n[1] Política de vacaciones (pág. 4)…\nPregunta: " + QUESTION,
            metrics: metrics(1, 412, 0, 0.91),
          },
          {
            nodeId: OLLAMA,
            block: "OllamaClient.generate",
            title: "Llama3 genera la respuesta",
            description: "El modelo local lee el contexto y redacta la respuesta citando la fuente.",
            input: { model: "llama3:8b", prompt_tokens: 412 },
            output: { answer: "El primer año tienes 22 días laborables de vacaciones (pág. 4).", completion_tokens: 58 },
            metrics: metrics(1840, 412, 58, 0.91),
            durationMs: 2600,
          },
        ]),
      },
      {
        id: "ingest-pdf",
        name: "Indexar un PDF",
        description: "Cómo un PDF subido se convierte en trozos vectorizados listos para buscarse.",
        entryNodeId: ROUTES,
        steps: buildSteps(graph, [
          {
            nodeId: ROUTES,
            block: "upload_document",
            title: "Se sube el PDF",
            description: "El endpoint recibe manual_empleado.pdf y lanza la ingesta.",
            input: { file: "manual_empleado.pdf", size_kb: 842 },
            output: { document_id: "manual" },
            metrics: metrics(22),
          },
          {
            nodeId: PIPELINE,
            block: "RagPipeline.ingest",
            title: "Empieza la ingesta",
            description: "El pipeline encadena cargar → trocear → vectorizar → indexar.",
            input: { document_id: "manual" },
            output: { step: "load" },
            metrics: metrics(1),
          },
          {
            nodeId: LOADER,
            block: "load_pdf",
            title: "Se extrae el texto",
            description: "Cada página se convierte en texto plano y conserva su número como metadato.",
            input: { file: "manual_empleado.pdf" },
            output: { pages: 12, chars: 18430 },
            metrics: metrics(140),
          },
          {
            nodeId: CHUNKER,
            block: "split_text",
            title: "El texto se trocea",
            description: "Trozos de ~500 tokens con 50 de solape para que ninguna idea quede partida.",
            input: { chars: 18430, chunk_tokens: 500, overlap: 50 },
            output: { chunks: 41 },
            metrics: metrics(9),
          },
          {
            nodeId: EMBEDDER,
            block: "embed_texts",
            title: "Cada trozo se vectoriza",
            description: "41 trozos → 41 vectores de 768 dimensiones, en 2 lotes.",
            input: { texts: 41, batch: 32 },
            output: { vectors: 41, dims: 768 },
            metrics: metrics(620, 20500, 0),
          },
          {
            nodeId: STORE,
            block: "VectorStore.upsert",
            title: "Se guardan en el índice",
            description: "Trozos, vectores y metadatos (página, documento) quedan persistidos.",
            input: { vectors: 41 },
            output: { indexed: 41, collection: "docs" },
            metrics: metrics(18),
          },
        ]),
      },
    ],
  },
  playground: {
    question: QUESTION,
    inputLabel: "Documento",
    documentName: "manual_empleado.pdf (muestra)",
    documentText: [CHUNK_C, CHUNK_A, CHUNK_B].join("\n\n"),
    model: "llama3:8b (simulado)",
    stages: [
      { stage: "api", label: "API /ask", nodeId: ROUTES, latencyMs: 4, detail: "petición validada" },
      { stage: "chunker", label: "Chunker", nodeId: CHUNKER, latencyMs: 9, detail: "3 trozos · 500 tokens · solape 50" },
      { stage: "embedder", label: "Embeddings (nomic)", nodeId: EMBEDDER, latencyMs: 212, detail: "4 vectores · 768 dims" },
      { stage: "vector_store", label: "Vector Store · top-3", nodeId: STORE, latencyMs: 6, detail: "mejor coincidencia 0.91" },
      { stage: "llm", label: "Llama3 (Ollama)", nodeId: OLLAMA, latencyMs: 1840, detail: "412 + 58 tokens" },
    ],
    answer:
      "Durante el **primer año** tienes **22 días laborables** de vacaciones, que se generan a razón de 1,83 días por mes trabajado (pág. 4).\n\nSi no los disfrutas todos, puedes trasladar hasta 5 días al año siguiente, siempre antes del 31 de marzo (pág. 5).",
    chunks: [
      { id: "manual.pdf#p4-1", text: CHUNK_A, score: 0.91 },
      { id: "manual.pdf#p5-2", text: CHUNK_B, score: 0.78 },
      { id: "manual.pdf#p2-3", text: CHUNK_C, score: 0.64 },
    ],
    usage: { promptTokens: 412, completionTokens: 58, totalTokens: 470 },
  },
};
