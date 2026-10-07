import { API_BACKEND_DEMO } from "./catalog/apiBackend";
import { AUDIO_PIPELINE_DEMO } from "./catalog/audioPipeline";
import { EVENT_DRIVEN_SHOP_DEMO } from "./catalog/eventDrivenShop";
import { RAG_DOCUMENTS_DEMO } from "./catalog/ragDocuments";
import { TOOL_CALLING_AGENT_DEMO } from "./catalog/toolCallingAgent";
import type { DemoDefinition } from "./types";

export type { DemoDefinition, DemoPlayground, DemoTraceProfile, DemoTraceStage } from "./types";

/** Demos en vivo, en el orden del selector. Van en el bundle: cargan sin red ni API key. */
export const DEMOS: readonly DemoDefinition[] = [RAG_DOCUMENTS_DEMO, TOOL_CALLING_AGENT_DEMO, AUDIO_PIPELINE_DEMO, EVENT_DRIVEN_SHOP_DEMO, API_BACKEND_DEMO];

export function demoByGraph(graphName: string): DemoDefinition | null {
  return DEMOS.find((demo) => demo.graphName === graphName) ?? null;
}
