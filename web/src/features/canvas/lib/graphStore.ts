/**
 * Persistencia de los grafos importados en IndexedDB (solo en este navegador). Se guarda lo mismo que vive en
 * memoria: el grafo (rutas, nombres de bloques, imports) y sus metadatos, nunca el contenido de los archivos.
 * Todo es "best effort": sin IndexedDB (modo privado estricto, SSR, tests) las funciones no hacen nada.
 */

const DB_NAME = "teacher";
const DB_VERSION = 1;
const STORE = "memoryGraphs";
/** Tope de grafos guardados; al pasarlo se borran los usados hace más tiempo. */
export const MAX_STORED_GRAPHS = 20;

export interface StoredGraph<G = unknown, M = unknown> {
  name: string;
  graph: G;
  meta: M;
  /** Último guardado o apertura: decide qué se borra primero. */
  savedAt: number;
}

/** Nombres a borrar para quedarse en `limit`: los de `savedAt` más antiguo. */
export function evictionsFor(entries: ReadonlyArray<Pick<StoredGraph, "name" | "savedAt">>, limit = MAX_STORED_GRAPHS): string[] {
  if (entries.length <= limit) return [];
  return [...entries]
    .sort((left, right) => right.savedAt - left.savedAt || left.name.localeCompare(right.name))
    .slice(limit)
    .map((entry) => entry.name);
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "name" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = body(transaction.objectStore(STORE));
          transaction.oncomplete = () => resolve(request ? request.result : null);
          transaction.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function listStoredGraphs<G, M>(): Promise<Array<StoredGraph<G, M>>> {
  const all = await run<StoredGraph<G, M>[]>("readonly", (store) => store.getAll() as IDBRequest<StoredGraph<G, M>[]>);
  return all ?? [];
}

/** Guarda (o sustituye) un grafo y borra los más antiguos si se pasa del tope. */
export async function putStoredGraph<G, M>(entry: StoredGraph<G, M>): Promise<void> {
  await run("readwrite", (store) => {
    store.put(entry);
  });
  const stale = evictionsFor(await listStoredGraphs());
  if (stale.length > 0) await run("readwrite", (store) => stale.forEach((name) => store.delete(name)));
}

export async function deleteStoredGraph(name: string): Promise<void> {
  await run("readwrite", (store) => {
    store.delete(name);
  });
}

/** Marca un grafo como usado ahora (lo aleja del desalojo). */
export async function touchStoredGraph(name: string, now = Date.now()): Promise<void> {
  const entry = await run<StoredGraph | undefined>("readonly", (store) => store.get(name) as IDBRequest<StoredGraph | undefined>);
  if (entry) await run("readwrite", (store) => void store.put({ ...entry, savedAt: now }));
}
