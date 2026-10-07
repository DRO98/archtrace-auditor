import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { CodeGraph } from "@core/graph";

/**
 * "Compartir estado" sin base de datos: el diagrama viaja comprimido en el hash de la URL
 * (`#data=…`). El fragmento después de `#` nunca se envía al servidor en la petición HTTP.
 */
export const SHARE_HASH_PREFIX = "#data=";
/** A partir de aquí algunos clientes (chats, correo, Edge antiguo) pueden cortar el enlace. */
export const LONG_URL_WARNING = 32_000;

export interface SharedView {
  selectedModuleId: string | null;
  presentation: boolean;
}

export interface SharePayload extends SharedView {
  v: 1;
  graph: CodeGraph;
}

export function encodeShareState(payload: SharePayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

/** `null` si el texto no es un estado compartido válido. El grafo se valida después con `loadCodeGraph`. */
export function decodeShareState(encoded: string): SharePayload | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<SharePayload> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.graph !== "object" || parsed.graph === null) return null;
    return {
      v: 1,
      graph: parsed.graph,
      selectedModuleId: typeof parsed.selectedModuleId === "string" ? parsed.selectedModuleId : null,
      presentation: parsed.presentation === true,
    };
  } catch {
    return null;
  }
}

/** Enlace completo a la vista actual (ruta del pipeline + `#data=`): el grafo va en el propio enlace. */
export function buildShareUrl(location: { origin: string; pathname: string }, payload: SharePayload): string {
  return `${location.origin}${location.pathname}${SHARE_HASH_PREFIX}${encodeShareState(payload)}`;
}

export function sharedDataFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_HASH_PREFIX) ? hash.slice(SHARE_HASH_PREFIX.length) : null;
}

/** Hash corto (djb2) para distinguir dos enlaces compartidos distintos en la misma pestaña. */
export function shortHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}
