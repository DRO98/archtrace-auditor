"use client";

import { create } from "zustand";
import { AI_PROVIDERS, currentModel, defaultModel, isModelName, isProviderId, type AiProviderId } from "./catalog";
import { isTokenPrice, type PriceOverrides, type TokenPrice } from "./costEstimate";
import { canSeal, isSealedBox, openJson, sealJson, type SealedBox } from "./secureStore";
import type { AiSelection } from "./types";

/** v1 guardaba las claves en claro; v2 las cifra (`secureStore`). v1 se migra y se borra al hidratar. */
const LEGACY_KEY = "tc:ai:v1";
const STORAGE_KEY = "tc:ai:v2";

/**
 * Ajustes de IA del navegador (el "vault" BYOK). Las claves se guardan cifradas en `localStorage` y
 * solo viajan a la API propia de la app, que las usa para esa petición y no las guarda.
 */
export interface AiSettings {
  /** null = lo que diga el `.env` del servidor. */
  provider: AiProviderId | null;
  models: Partial<Record<AiProviderId, string>>;
  keys: Partial<Record<AiProviderId, string>>;
  /** Tarifas escritas a mano por `priceKey(provider, model)`: modelos nuevos, locales o fuera del catálogo. */
  prices: Record<string, TokenPrice>;
  /** URL OpenAI-compatible del servidor local (Ollama / vLLM). Vacía = la del `.env` o `localhost:11434`. */
  localBaseUrl: string;
}

export type VaultMode = "encrypted" | "plain";

interface AiSettingsState extends AiSettings {
  /** true cuando las claves ya están descifradas en memoria. */
  hydrated: boolean;
  /** Cómo se guardan las claves en este navegador: cifradas o, sin Web Crypto, en claro. */
  vault: VaultMode;
  /** Aviso si no se pudo descifrar lo guardado (p. ej. se borró IndexedDB): hay que volver a pegar las claves. */
  vaultError: string | null;
  hydrate: () => Promise<void>;
  save: (next: AiSettings) => Promise<void>;
}

export const EMPTY_SETTINGS: AiSettings = { provider: null, models: {}, keys: {}, prices: {}, localBaseUrl: "" };

let hydrating: Promise<void> | null = null;

export const useAiSettings = create<AiSettingsState>((set) => ({
  ...EMPTY_SETTINGS,
  hydrated: false,
  vault: "encrypted",
  vaultError: null,
  hydrate: () => {
    hydrating ??= loadSettings().then((loaded) => set({ ...loaded, hydrated: true }));
    return hydrating;
  },
  save: async (next) => {
    set({ ...pickSettings(next), hydrated: true });
    const vault = await writeSettings(next);
    set({ vault, vaultError: null });
  },
}));

export function pickSettings({ provider, models, keys, prices, localBaseUrl }: AiSettings): AiSettings {
  return { provider, models, keys, prices, localBaseUrl };
}

/** Ajustes actuales: los del store si ya hidrató; si no, lo legible sin descifrar (sin claves cifradas). */
export function currentSettings(): AiSettings {
  const state = useAiSettings.getState();
  return state.hydrated ? state : readSettings();
}

export function modelFor(settings: AiSettings, provider: AiProviderId): string {
  const saved = settings.models[provider];
  return saved && isModelName(saved) ? currentModel(provider, saved) : defaultModel(provider);
}

/** Selección para `provider`/`model` con la clave y la URL local guardadas. */
export function selectionFor(settings: AiSettings, provider: AiProviderId, model: string): AiSelection {
  const needsKey = AI_PROVIDERS[provider].needsKey;
  const apiKey = settings.keys[provider]?.trim() || undefined;
  const baseUrl = !needsKey && settings.localBaseUrl.trim() ? settings.localBaseUrl.trim() : undefined;
  return { provider, model, apiKey, ...(baseUrl ? { baseUrl } : {}) };
}

/** Lo que se adjunta como `ai` en las peticiones. Sin proveedor elegido no se envía nada. */
export function aiSelection(): AiSelection | undefined {
  const settings = currentSettings();
  const provider = settings.provider;
  if (!provider) return undefined;
  return selectionFor(settings, provider, modelFor(settings, provider));
}

/** Tarifas manuales guardadas (para `resolvePrice`). */
export function priceOverrides(): PriceOverrides {
  return currentSettings().prices;
}

/**
 * Lectura síncrona sin descifrar: proveedor, modelos, tarifas y URL local. Las claves solo aparecen
 * si están en claro (v1 sin migrar o navegador sin Web Crypto); las cifradas llegan con `hydrate()`.
 */
export function readSettings(): AiSettings {
  const current = readRecord(STORAGE_KEY);
  if (current) return { ...parsePublic(current), keys: pickStrings(current.keys) };
  const legacy = readRecord(LEGACY_KEY);
  if (legacy) return { ...parsePublic(legacy), keys: pickStrings(legacy.keys) };
  return EMPTY_SETTINGS;
}

async function loadSettings(): Promise<Pick<AiSettingsState, keyof AiSettings | "vault" | "vaultError">> {
  const current = readRecord(STORAGE_KEY);
  if (current) {
    const base = parsePublic(current);
    if (isSealedBox(current.sealed)) {
      try {
        const keys = pickStrings(await openJson(current.sealed));
        return { ...base, keys, vault: "encrypted", vaultError: null };
      } catch {
        return {
          ...base,
          keys: {},
          vault: "encrypted",
          vaultError: "No se pudieron descifrar las claves guardadas (¿se borraron los datos del sitio?). Vuelve a pegarlas.",
        };
      }
    }
    const keys = pickStrings(current.keys);
    // Guardadas en claro en un navegador sin Web Crypto: si ahora se puede, se cifran.
    const vault = Object.keys(keys).length > 0 && canSeal() ? await writeSettings({ ...base, keys }) : canSeal() ? "encrypted" : "plain";
    return { ...base, keys, vault, vaultError: null };
  }

  const legacy = readRecord(LEGACY_KEY);
  if (!legacy) return { ...EMPTY_SETTINGS, vault: canSeal() ? "encrypted" : "plain", vaultError: null };
  const migrated: AiSettings = { ...parsePublic(legacy), keys: pickStrings(legacy.keys) };
  const vault = await writeSettings(migrated);
  if (vault === "encrypted") removeItem(LEGACY_KEY);
  return { ...migrated, vault, vaultError: null };
}

/** Guarda en v2. Devuelve cómo quedaron las claves: cifradas o, si no hay Web Crypto, en claro. */
async function writeSettings(settings: AiSettings): Promise<VaultMode> {
  const keys = Object.fromEntries(Object.entries(settings.keys).filter(([, value]) => value?.trim()));
  const base = {
    provider: settings.provider,
    models: settings.models,
    prices: settings.prices,
    localBaseUrl: settings.localBaseUrl,
  };
  let sealed: SealedBox | null = null;
  if (canSeal()) {
    try {
      sealed = await sealJson(keys);
    } catch {
      sealed = null;
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed ? { ...base, sealed } : { ...base, keys }));
    removeItem(LEGACY_KEY);
  } catch {
    // Almacenamiento lleno o bloqueado: los ajustes duran lo que dure la pestaña.
  }
  return sealed ? "encrypted" : "plain";
}

function parsePublic(record: Record<string, unknown>): Omit<AiSettings, "keys"> {
  return {
    provider: isProviderId(record.provider) ? record.provider : null,
    models: pickStrings(record.models),
    prices: pickPrices(record.prices),
    localBaseUrl: typeof record.localBaseUrl === "string" ? record.localBaseUrl.trim().slice(0, 300) : "",
  };
}

function readRecord(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Bloqueado: no pasa nada.
  }
}

function pickStrings(raw: unknown): Partial<Record<AiProviderId, string>> {
  const out: Partial<Record<AiProviderId, string>> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (isProviderId(key) && typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

function pickPrices(raw: unknown): Record<string, TokenPrice> {
  const out: Record<string, TokenPrice> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    const provider = key.slice(0, key.indexOf(":"));
    if (isProviderId(provider) && isTokenPrice(value)) out[key] = { input: value.input, output: value.output };
  }
  return out;
}
