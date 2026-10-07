import type { CodeGraph } from "@core/graph";
import { buildModule, buildSteps, edge, metrics } from "../lib/build";
import type { DemoDefinition } from "../types";

const UPLOAD = "pipeline/api/upload.py";
const ORCHESTRATOR = "pipeline/orchestrator.py";
const PREPROCESS = "pipeline/audio/preprocess.py";
const TRANSCRIBER = "pipeline/audio/transcriber.py";
const CLEANER = "pipeline/text/cleaner.py";
const SUMMARIZER = "pipeline/text/summarizer.py";
const PROMPTS = "pipeline/text/prompts.py";
const RESULTS = "pipeline/storage/results_db.py";

const graph: CodeGraph = {
  version: 1,
  projectName: "Demo · Pipeline de Audio y Texto",
  groups: [
    { id: "api", label: "API", color: "sky" },
    { id: "core", label: "Orquestación", color: "violet" },
    { id: "audio", label: "Audio", color: "rose" },
    { id: "text", label: "Texto", color: "amber" },
    { id: "storage", label: "Almacenamiento", color: "emerald" },
  ],
  subsystems: [
    { id: "audio", label: "Audio · Preproceso y transcripción", color: "rose" },
    { id: "inference", label: "Texto · Limpieza y resumen", color: "amber" },
    { id: "infra", label: "Resultados", color: "emerald" },
  ],
  modules: [
    buildModule({
      id: UPLOAD,
      label: "Upload API",
      groupId: "api",
      role: "api",
      layer: 0,
      summary: "Recibe un audio (wav/mp3/m4a), lo guarda en disco temporal y encola su procesamiento.",
      blocks: [["upload_audio", 12, 38, "POST /recordings: valida formato y duración (≤ 2 h)."]],
    }),
    buildModule({
      id: ORCHESTRATOR,
      label: "Pipeline Orchestrator",
      groupId: "core",
      role: "pipeline",
      layer: 3,
      summary: "Encadena audio → texto: preprocesar, transcribir, limpiar, resumir y guardar, con reintentos por etapa.",
      blocks: [["process_recording", 15, 72, "Ejecuta las 5 etapas y registra la latencia de cada una."]],
    }),
    buildModule({
      id: PREPROCESS,
      label: "Audio Preprocess",
      groupId: "audio",
      role: "transform",
      layer: 1,
      subsystem: "audio",
      summary: "Convierte a 16 kHz mono, normaliza volumen y corta por silencios en segmentos de ≤ 30 s.",
      blocks: [
        ["normalize_audio", 8, 30, "ffmpeg: 16 kHz, mono, -16 LUFS."],
        ["split_on_silence", 32, 60, "Segmentos de ≤ 30 s cortados en pausas."],
      ],
    }),
    buildModule({
      id: TRANSCRIBER,
      label: "Whisper Transcriber",
      groupId: "audio",
      role: "ai-model",
      layer: 2,
      subsystem: "audio",
      summary: "Transcribe cada segmento con Whisper (faster-whisper, modelo small) y devuelve texto con marcas de tiempo.",
      blocks: [
        ["WhisperTranscriber", 6, 56],
        ["WhisperTranscriber.transcribe", 20, 54, "Segmentos → [{start, end, text}]."],
      ],
    }),
    buildModule({
      id: CLEANER,
      label: "Transcript Cleaner",
      groupId: "text",
      role: "transform",
      layer: 1,
      subsystem: "inference",
      summary: "Une segmentos, quita muletillas y repeticiones y añade puntuación para que el texto sea legible.",
      blocks: [["clean_transcript", 5, 36, "Muletillas fuera, frases unidas, puntuación."]],
    }),
    buildModule({
      id: SUMMARIZER,
      label: "Summarizer",
      groupId: "text",
      role: "ai-model",
      layer: 4,
      subsystem: "inference",
      summary: "Genera resumen, decisiones y tareas pendientes con Llama3 en local.",
      blocks: [["summarize", 10, 49, "Devuelve JSON {resumen, decisiones, tareas}."]],
    }),
    buildModule({
      id: PROMPTS,
      label: "Summary Prompt",
      groupId: "text",
      role: "prompt",
      layer: 4,
      subsystem: "inference",
      supportOf: SUMMARIZER,
      summary: "Plantilla que pide un resumen de reunión en JSON con tareas y responsables.",
      blocks: [["summary_prompt", 3, 26, "Formato JSON estricto + ejemplos."]],
    }),
    buildModule({
      id: RESULTS,
      label: "Results DB",
      groupId: "storage",
      role: "database",
      layer: 2,
      subsystem: "infra",
      summary: "Guarda transcripción, resumen y métricas por grabación (SQLite).",
      blocks: [["save_result", 10, 35, "INSERT en recordings y summaries."]],
    }),
  ],
  edges: [
    edge(UPLOAD, ORCHESTRATOR),
    edge(ORCHESTRATOR, PREPROCESS),
    edge(ORCHESTRATOR, TRANSCRIBER),
    edge(ORCHESTRATOR, CLEANER),
    edge(ORCHESTRATOR, SUMMARIZER),
    edge(SUMMARIZER, PROMPTS),
    edge(ORCHESTRATOR, RESULTS),
  ],
};

const SEG_A = "[00:00–00:28] Vale, eh, empezamos. La idea es lanzar la beta el día 15, pero, eh, falta cerrar el onboarding.";
const SEG_B = "[00:28–00:55] Marta se encarga del onboarding y Luis revisa los precios antes del viernes.";
const SEG_C = "[00:55–01:20] Decidimos quitar el plan gratuito de la beta y ofrecer 14 días de prueba.";
const TRANSCRIPT = [SEG_A, SEG_B, SEG_C].join("\n");

export const AUDIO_PIPELINE_DEMO: DemoDefinition = {
  graphName: "demo_audio_pipeline",
  title: "Pipeline de Audio y Texto",
  tagline: "Whisper + Llama3: de una reunión grabada a tareas",
  graph,
  scenarios: {
    version: 1,
    graph: "demo_audio_pipeline",
    scenarios: [
      {
        id: "meeting-to-summary",
        name: "De reunión a resumen",
        description: "Un audio de reunión atraviesa preproceso, transcripción, limpieza y resumen hasta quedar guardado.",
        entryNodeId: UPLOAD,
        steps: buildSteps(graph, [
          {
            nodeId: UPLOAD,
            block: "upload_audio",
            title: "Se sube la grabación",
            description: "El endpoint valida formato y duración y encola el procesamiento.",
            input: { file: "reunion_producto.m4a", duration_s: 80, size_mb: 1.3 },
            output: { recording_id: "rec-107", status: "queued" },
            metrics: metrics(35),
          },
          {
            nodeId: ORCHESTRATOR,
            block: "process_recording",
            title: "El orquestador toma el trabajo",
            description: "Ejecutará 5 etapas en orden, con reintentos si alguna falla.",
            input: { recording_id: "rec-107" },
            output: { stages: ["preprocess", "transcribe", "clean", "summarize", "save"] },
            metrics: metrics(1),
          },
          {
            nodeId: PREPROCESS,
            block: "normalize_audio",
            title: "El audio se normaliza",
            description: "Se convierte a 16 kHz mono (lo que espera Whisper) y se iguala el volumen.",
            input: { sample_rate: 44100, channels: 2 },
            output: { sample_rate: 16000, channels: 1, loudness: "-16 LUFS" },
            metrics: metrics(180),
          },
          {
            nodeId: PREPROCESS,
            block: "split_on_silence",
            title: "Se corta por silencios",
            description: "Segmentos de ≤ 30 s cortados en pausas para no partir palabras.",
            input: { duration_s: 80 },
            output: { segments: 3 },
            metrics: metrics(60),
          },
          {
            nodeId: TRANSCRIBER,
            block: "WhisperTranscriber.transcribe",
            title: "Whisper transcribe",
            description: "Cada segmento se convierte en texto con marcas de tiempo.",
            input: { segments: 3, model: "whisper-small", language: "es" },
            output: TRANSCRIPT,
            metrics: metrics(2900, 0, 96),
            durationMs: 2600,
          },
          {
            nodeId: CLEANER,
            block: "clean_transcript",
            title: "Se limpia el texto",
            description: "Fuera muletillas («eh», «vale») y repeticiones; se une en párrafos con puntuación.",
            input: { chars: TRANSCRIPT.length },
            output: "Empezamos. La idea es lanzar la beta el día 15, pero falta cerrar el onboarding. Marta se encarga del onboarding y Luis revisa los precios antes del viernes…",
            metrics: metrics(12),
          },
          {
            nodeId: SUMMARIZER,
            block: "summarize",
            title: "Llama3 resume",
            description: "El modelo local extrae resumen, decisiones y tareas con responsable.",
            input: { model: "llama3:8b", prompt_tokens: 380 },
            output: { decisiones: ["Beta sin plan gratuito; prueba de 14 días"], tareas: [{ quien: "Marta", que: "onboarding" }, { quien: "Luis", que: "precios" }] },
            metrics: metrics(1650, 380, 120),
            durationMs: 2400,
          },
          {
            nodeId: RESULTS,
            block: "save_result",
            title: "Se guarda el resultado",
            description: "Transcripción, resumen y métricas quedan disponibles para la interfaz.",
            input: { recording_id: "rec-107" },
            output: { saved: true },
            metrics: metrics(8),
          },
        ]),
      },
    ],
  },
  playground: {
    question: "Resume la reunión y lista las tareas con su responsable.",
    inputLabel: "Audio de entrada (transcripción de muestra)",
    documentName: "reunion_producto.m4a (muestra)",
    documentText: TRANSCRIPT,
    model: "whisper-small + llama3:8b (simulado)",
    stages: [
      { stage: "api", label: "Upload API", nodeId: UPLOAD, latencyMs: 35, detail: "80 s · 1,3 MB" },
      { stage: "chunker", label: "Preproceso de audio", nodeId: PREPROCESS, latencyMs: 240, detail: "16 kHz mono · 3 segmentos" },
      { stage: "llm", label: "Transcripción (Whisper)", nodeId: TRANSCRIBER, latencyMs: 2900, detail: "96 palabras · idioma es" },
      { stage: "chunker", label: "Limpieza de texto", nodeId: CLEANER, latencyMs: 12, detail: "−9 muletillas" },
      { stage: "llm", label: "Resumen (Llama3)", nodeId: SUMMARIZER, latencyMs: 1650, detail: "380 + 120 tokens" },
      { stage: "vector_store", label: "Guardar resultado", nodeId: RESULTS, latencyMs: 8, detail: "rec-107" },
    ],
    answer:
      "**Resumen:** el equipo prepara el lanzamiento de la beta para el día 15; queda pendiente cerrar el onboarding.\n\n**Decisiones**\n- La beta no tendrá plan gratuito: habrá 14 días de prueba.\n\n**Tareas**\n- **Marta** — cerrar el onboarding.\n- **Luis** — revisar los precios antes del viernes.",
    chunks: [
      { id: "segmento 1 · 00:00–00:28", text: SEG_A, score: 0.88 },
      { id: "segmento 2 · 00:28–00:55", text: SEG_B, score: 0.95 },
      { id: "segmento 3 · 00:55–01:20", text: SEG_C, score: 0.92 },
    ],
    usage: { promptTokens: 380, completionTokens: 120, totalTokens: 500 },
  },
};
