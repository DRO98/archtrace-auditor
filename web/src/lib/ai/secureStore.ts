"use client";

/**
 * Cifrado local de las API keys: AES-GCM 256 con una clave **no extraíble** guardada en IndexedDB.
 * `localStorage` solo contiene el texto cifrado, así que copiar ese valor (extensiones, volcados del
 * perfil, capturas de DevTools) no revela las claves. No protege frente a código que corra en la
 * propia página (XSS): ese código podría pedir el descifrado igual que la app.
 */

const DB_NAME = "tc-vault";
const STORE = "keys";
const KEY_ID = "aes-gcm-v1";

export interface SealedBox {
  /** Vector de inicialización (12 bytes) en base64. */
  iv: string;
  /** Texto cifrado + etiqueta GCM en base64. */
  data: string;
}

let cryptoKey: Promise<CryptoKey> | null = null;

/** false en contextos sin Web Crypto o IndexedDB (HTTP en otra máquina, modo privado estricto…). */
export function canSeal(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined" && Boolean(globalThis.crypto?.subtle);
}

export async function sealJson(value: unknown): Promise<SealedBox> {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/** Descifra; lanza si la clave de IndexedDB se borró o el texto se manipuló (GCM lo detecta). */
export async function openJson(box: SealedBox): Promise<unknown> {
  const key = await vaultKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.data));
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}

export function isSealedBox(value: unknown): value is SealedBox {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.iv === "string" && typeof record.data === "string";
}

function vaultKey(): Promise<CryptoKey> {
  cryptoKey ??= loadOrCreateKey().catch((error: unknown) => {
    cryptoKey = null;
    throw error;
  });
  return cryptoKey;
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await request<CryptoKey | undefined>(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID));
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    // `add` y no `put`: si otra pestaña la creó a la vez, gana la suya y se relee.
    try {
      await request(db.transaction(STORE, "readwrite").objectStore(STORE).add(created, KEY_ID));
      return created;
    } catch {
      const winner = await request<CryptoKey | undefined>(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID));
      if (!winner) throw new Error("No se pudo guardar la clave de cifrado.");
      return winner;
    }
  } finally {
    db.close();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB no disponible."));
  });
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("Fallo de IndexedDB."));
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
