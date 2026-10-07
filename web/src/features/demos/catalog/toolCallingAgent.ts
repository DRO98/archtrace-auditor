import type { CodeGraph } from "@core/graph";
import { buildModule, buildSteps, edge, metrics } from "../lib/build";
import type { DemoDefinition } from "../types";

const SERVER = "agent/server.ts";
const LOOP = "agent/loop.ts";
const CLIENT = "agent/llm/client.ts";
const SYSTEM = "agent/llm/systemPrompt.ts";
const REGISTRY = "agent/tools/registry.ts";
const SEARCH = "agent/tools/webSearch.ts";
const FETCH = "agent/tools/fetchPage.ts";
const MEMORY = "agent/memory/conversation.ts";

const graph: CodeGraph = {
  version: 1,
  projectName: "Demo · Agente con Búsqueda Web",
  groups: [
    { id: "api", label: "API", color: "sky" },
    { id: "agent", label: "Agente", color: "violet" },
    { id: "llm", label: "LLM", color: "amber" },
    { id: "tools", label: "Herramientas", color: "emerald" },
    { id: "memory", label: "Memoria", color: "zinc" },
  ],
  subsystems: [
    { id: "inference", label: "Razonamiento · LLM con tool calling", color: "amber" },
    { id: "tools", label: "Herramientas · Búsqueda web", color: "emerald" },
    { id: "infra", label: "Memoria de conversación", color: "zinc" },
  ],
  modules: [
    buildModule({
      id: SERVER,
      label: "Chat Server",
      groupId: "api",
      role: "api",
      layer: 0,
      summary: "Endpoint /chat: recibe el mensaje del usuario y devuelve la respuesta final del agente.",
      blocks: [["handleChat", 10, 41, "Carga el historial, ejecuta el agente y guarda el turno."]],
    }),
    buildModule({
      id: LOOP,
      label: "Agent Loop",
      groupId: "agent",
      role: "pipeline",
      layer: 3,
      summary: "Bucle razonar → actuar → observar: pide al LLM el siguiente paso y ejecuta herramientas hasta tener respuesta (máx. 5 iteraciones).",
      blocks: [
        ["runAgent", 12, 80, "Itera mientras el LLM pida herramientas."],
        ["shouldStop", 82, 96, "Corta por respuesta final o límite de iteraciones."],
      ],
    }),
    buildModule({
      id: CLIENT,
      label: "LLM Client",
      groupId: "llm",
      role: "ai-model",
      layer: 4,
      subsystem: "inference",
      summary: "Llama al modelo con el esquema JSON de las herramientas; el modelo responde texto o una llamada a herramienta.",
      blocks: [["chatWithTools", 8, 52, "Chat completions con `tools` y `tool_choice: auto`."]],
    }),
    buildModule({
      id: SYSTEM,
      label: "System Prompt",
      groupId: "llm",
      role: "prompt",
      layer: 4,
      subsystem: "inference",
      supportOf: CLIENT,
      summary: "Instrucciones del agente: cuándo buscar en la web, cómo citar fuentes y cuándo parar.",
      blocks: [["buildSystemPrompt", 3, 31, "Fecha actual + reglas de uso de herramientas."]],
    }),
    buildModule({
      id: REGISTRY,
      label: "Tool Registry",
      groupId: "tools",
      role: "service",
      layer: 2,
      subsystem: "tools",
      summary: "Catálogo de herramientas: publica sus esquemas JSON y enruta cada tool_call a su implementación.",
      blocks: [
        ["toolSchemas", 5, 40, "web_search y fetch_page en formato JSON Schema."],
        ["dispatchTool", 42, 71, "Valida argumentos y ejecuta la herramienta pedida."],
      ],
    }),
    buildModule({
      id: SEARCH,
      label: "Web Search",
      groupId: "tools",
      role: "service",
      layer: 2,
      subsystem: "tools",
      summary: "Consulta una API de búsqueda y devuelve los 5 primeros resultados (título, URL, extracto).",
      blocks: [["webSearch", 10, 46, "GET a la API de búsqueda con la query del LLM."]],
    }),
    buildModule({
      id: FETCH,
      label: "Page Fetcher",
      groupId: "tools",
      role: "transform",
      layer: 1,
      subsystem: "tools",
      summary: "Descarga una URL y extrae el texto legible, recortado a 3.000 tokens.",
      blocks: [
        ["fetchPage", 8, 40, "Descarga con timeout de 8 s."],
        ["extractReadable", 42, 70, "Quita menús y scripts; se queda con el artículo."],
      ],
    }),
    buildModule({
      id: MEMORY,
      label: "Conversation Memory",
      groupId: "memory",
      role: "database",
      layer: 2,
      subsystem: "infra",
      summary: "Historial de mensajes por sesión (incluye tool_calls y sus resultados) para dar contexto al LLM.",
      blocks: [
        ["ConversationMemory", 5, 52],
        ["ConversationMemory.history", 14, 28, "Últimos 20 mensajes de la sesión."],
        ["ConversationMemory.append", 30, 50, "Añade mensajes del turno actual."],
      ],
    }),
  ],
  edges: [
    edge(SERVER, LOOP),
    edge(SERVER, MEMORY),
    edge(LOOP, CLIENT),
    edge(CLIENT, SYSTEM),
    edge(LOOP, REGISTRY),
    edge(REGISTRY, SEARCH),
    edge(REGISTRY, FETCH),
  ],
};

const QUESTION = "¿Qué novedades trae la última versión de Llama y cuándo salió?";
const RESULT_A = "Meta publica Llama 4: modelos Scout y Maverick con arquitectura mixture-of-experts y ventana de contexto de hasta 10M tokens.";
const RESULT_B = "Comparativa: Llama 4 Maverick supera a su predecesor en razonamiento y programación con menor coste por token.";
const RESULT_C = "Blog de Meta AI (5 abr.): los pesos de Scout y Maverick están disponibles para descarga bajo la licencia comunitaria.";

export const TOOL_CALLING_AGENT_DEMO: DemoDefinition = {
  graphName: "demo_tool_agent",
  title: "Agente de Tool Calling",
  tagline: "Un LLM que decide buscar en la web y cita fuentes",
  graph,
  scenarios: {
    version: 1,
    graph: "demo_tool_agent",
    scenarios: [
      {
        id: "web-search-answer",
        name: "Pregunta que necesita la web",
        description: "El agente detecta que no sabe la respuesta, busca en la web, lee la página y responde citando la fuente.",
        entryNodeId: SERVER,
        steps: buildSteps(graph, [
          {
            nodeId: SERVER,
            block: "handleChat",
            title: "Llega el mensaje",
            description: "El servidor recibe la pregunta y recupera el historial de la sesión.",
            input: { session: "s-42", message: QUESTION },
            output: { message: QUESTION, history: 4 },
            metrics: metrics(3),
          },
          {
            nodeId: MEMORY,
            block: "ConversationMemory.history",
            title: "Se carga la memoria",
            description: "Los últimos mensajes dan contexto: el usuario ya preguntó antes por modelos open source.",
            input: { session: "s-42" },
            output: { messages: 4 },
            metrics: metrics(2),
          },
          {
            nodeId: LOOP,
            block: "runAgent",
            title: "Arranca el bucle del agente",
            description: "Iteración 1 de 5: el agente pide al LLM que decida el siguiente paso.",
            input: { iteration: 1, max: 5 },
            output: { step: "think" },
            metrics: metrics(1),
          },
          {
            nodeId: CLIENT,
            block: "chatWithTools",
            title: "El LLM decide usar una herramienta",
            description: "Como la pregunta es sobre algo reciente, el modelo no responde: emite una llamada a web_search.",
            input: { tools: ["web_search", "fetch_page"], tool_choice: "auto" },
            output: { tool_calls: [{ name: "web_search", arguments: { query: "Llama última versión novedades" } }] },
            metrics: metrics(640, 890, 24),
            durationMs: 2400,
          },
          {
            nodeId: REGISTRY,
            block: "dispatchTool",
            title: "Se enruta la llamada",
            description: "El registro valida los argumentos contra el esquema JSON y ejecuta web_search.",
            input: { name: "web_search", arguments: { query: "Llama última versión novedades" } },
            output: { dispatched: "webSearch" },
            metrics: metrics(1),
          },
          {
            nodeId: SEARCH,
            block: "webSearch",
            title: "Búsqueda en la web",
            description: "La API de búsqueda devuelve 5 resultados con título, URL y extracto.",
            input: { query: "Llama última versión novedades", count: 5 },
            output: { results: [{ title: "Meta publica Llama 4", url: "https://ai.meta.com/blog/…" }, "… 4 más"] },
            metrics: metrics(420, 0, 0, 0.86),
          },
          {
            nodeId: FETCH,
            block: "fetchPage",
            title: "Se lee la página más relevante",
            description: "El agente pide abrir el primer resultado; se extrae el texto legible.",
            input: { url: "https://ai.meta.com/blog/…" },
            output: { tokens: 1840, excerpt: RESULT_C },
            metrics: metrics(760, 0, 0, 0.9),
          },
          {
            nodeId: CLIENT,
            block: "chatWithTools",
            title: "El LLM redacta la respuesta",
            description: "Con los resultados como mensajes `tool`, el modelo ya puede responder y citar fuentes.",
            input: { messages: 8, tool_results: 2 },
            output: { content: "La última versión es Llama 4 (abril)…", finish_reason: "stop" },
            metrics: metrics(1320, 2960, 142, 0.9),
            durationMs: 2600,
          },
          {
            nodeId: SERVER,
            block: "handleChat",
            title: "Respuesta al usuario",
            description: "El servidor guarda el turno (con sus tool_calls) en memoria y devuelve la respuesta.",
            input: { content: "La última versión es Llama 4…" },
            output: { status: 200, citations: 2 },
            metrics: metrics(4),
          },
        ]),
      },
    ],
  },
  playground: {
    question: QUESTION,
    inputLabel: "Herramientas disponibles",
    documentName: "tools.json (muestra)",
    documentText: JSON.stringify(
      [
        { name: "web_search", description: "Busca en la web", parameters: { query: "string" } },
        { name: "fetch_page", description: "Lee una URL", parameters: { url: "string" } },
      ],
      null,
      2,
    ),
    model: "llama3.1:8b tool-calling (simulado)",
    stages: [
      { stage: "api", label: "Chat Server", nodeId: SERVER, latencyMs: 3, detail: "sesión s-42 · 4 mensajes previos" },
      { stage: "llm", label: "LLM decide → tool_call", nodeId: CLIENT, latencyMs: 640, detail: "web_search(\"Llama última versión\")" },
      { stage: "api", label: "Tool Registry", nodeId: REGISTRY, latencyMs: 1, detail: "argumentos válidos" },
      { stage: "vector_store", label: "Búsqueda web", nodeId: SEARCH, latencyMs: 420, detail: "5 resultados" },
      { stage: "chunker", label: "Leer página", nodeId: FETCH, latencyMs: 760, detail: "1.840 tokens extraídos" },
      { stage: "llm", label: "LLM responde", nodeId: CLIENT, latencyMs: 1320, detail: "2.960 + 142 tokens" },
    ],
    answer:
      "La versión más reciente es **Llama 4**, publicada por Meta en abril. Sus novedades principales:\n\n- Dos modelos abiertos, **Scout** y **Maverick**, con arquitectura *mixture-of-experts*.\n- Ventana de contexto de hasta **10M tokens** en Scout.\n- Mejor razonamiento y programación que Llama 3 con menor coste por token.\n\nFuentes: blog de Meta AI, comparativa de benchmarks (resultados de `web_search`).",
    chunks: [
      { id: "web_search#1 · ai.meta.com", text: RESULT_A, score: 0.93 },
      { id: "fetch_page · ai.meta.com/blog", text: RESULT_C, score: 0.9 },
      { id: "web_search#2 · benchmarks", text: RESULT_B, score: 0.81 },
    ],
    usage: { promptTokens: 3850, completionTokens: 166, totalTokens: 4016 },
  },
};
