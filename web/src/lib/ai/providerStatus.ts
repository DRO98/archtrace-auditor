"use client";

import { create } from "zustand";
import { networkErrorMessage, postJson, readApiError } from "@/lib/http";
import { AI_PROVIDER_IDS, AI_PROVIDERS, isUsableKey, type AiProviderId } from "./catalog";
import { resolvePrice, type PriceOverrides, type PriceSource, type TokenPrice } from "./costEstimate";
import { scanOllamaModels, type LocalModelInfo } from "./localScan";
import type { DiscoveredModel } from "./modelDiscovery";
import { currentSettings, useAiSettings, type AiSettings } from "./settings";

export type KeySource = "browser" | "server" | "local";

/**
 * Estado de un proveedor en el vault. `connected` = su API aceptó la clave y devolvió modelos;
 * `auth_error` = 401/403; `quota` = sin saldo; `error` = red, URL local inválida, proveedor caído…
 */
export type ProviderCheckStatus = "idle" | "checking" | "connected" | "auth_error" | "quota" | "error" | "unconfigured";

export interface ProviderCheck {
  status: ProviderCheckStatus;
  models: DiscoveredModel[];
  keySource: KeySource | null;
  message: string | null;
  checkedAt: number | null;
}

/** Un modelo listo para un selector: tarifa ya resuelta con los precios manuales. */
export interface SelectableModel {
  provider: AiProviderId;
  id: string;
  label: string;
  price: TokenPrice | null;
  priceSource: PriceSource;
}

/** Resultado del escaneo directo de `/api/tags` del servidor local (Ollama). */
export interface LocalScan {
  status: "idle" | "scanning" | "done" | "fallback";
  models: LocalModelInfo[];
  /** `fallback`: por qué no se pudo escanear y se recurrió al listado OpenAI-compatible (vLLM, CORS…). */
  message: string | null;
  scannedAt: number | null;
}

const IDLE: ProviderCheck = { status: "idle", models: [], keySource: null, message: null, checkedAt: null };

interface ProviderStatusState {
  checks: Record<AiProviderId, ProviderCheck>;
  /** Verifica un proveedor con la clave indicada (o la guardada / la del `.env`) y carga sus modelos. */
  verify: (provider: AiProviderId, override?: { apiKey?: string; baseUrl?: string }) => Promise<ProviderCheck>;
  /** Verifica una vez por sesión los proveedores con clave (navegador o servidor) y el servidor local. */
  verifyConfigured: (serverKeys?: Partial<Record<AiProviderId, boolean>>) => Promise<void>;
  reset: (provider: AiProviderId) => void;
  localScan: LocalScan;
  /**
   * Detecta los modelos instalados en el servidor local pidiendo `GET /api/tags` desde el navegador. Si
   * responde, el proveedor local queda conectado con esos modelos; si no, recurre a `verify("ollama")`.
   */
  scanLocal: (baseUrl?: string, apiKey?: string) => Promise<ProviderCheck>;
}

const inFlight = new Map<AiProviderId, { signature: string; promise: Promise<ProviderCheck> }>();

export const useProviderStatus = create<ProviderStatusState>((set, get) => ({
  checks: Object.fromEntries(AI_PROVIDER_IDS.map((id) => [id, IDLE])) as Record<AiProviderId, ProviderCheck>,

  verify: (provider, override) => {
    const settings = currentSettings();
    const apiKey = (override?.apiKey ?? settings.keys[provider] ?? "").trim() || undefined;
    const baseUrl = AI_PROVIDERS[provider].needsKey ? undefined : (override?.baseUrl ?? settings.localBaseUrl).trim() || undefined;
    const signature = `${apiKey ?? ""}|${baseUrl ?? ""}`;
    const pending = inFlight.get(provider);
    if (pending && pending.signature === signature) return pending.promise;

    const put = (check: ProviderCheck): ProviderCheck => {
      // Una verificación más reciente (otra clave) manda: la vieja no pisa su resultado.
      if (inFlight.get(provider)?.signature === signature) set({ checks: { ...get().checks, [provider]: check } });
      return check;
    };
    set({ checks: { ...get().checks, [provider]: { ...get().checks[provider], status: "checking", message: null } } });
    const promise = requestModels(provider, apiKey, baseUrl)
      .then(put)
      .finally(() => {
        if (inFlight.get(provider)?.signature === signature) inFlight.delete(provider);
      });
    inFlight.set(provider, { signature, promise });
    return promise;
  },

  verifyConfigured: async (serverKeys = {}) => {
    const settings = currentSettings();
    const targets = AI_PROVIDER_IDS.filter((id) => {
      if (get().checks[id].status !== "idle") return false;
      if (!AI_PROVIDERS[id].needsKey) return true;
      return isUsableKey(settings.keys[id]) || serverKeys[id] === true;
    });
    // El servidor local se detecta escaneando `/api/tags` desde el navegador (con respaldo en el listado del servidor).
    await Promise.all(targets.map((id) => (id === "ollama" ? get().scanLocal() : get().verify(id))));
  },

  reset: (provider) => set({ checks: { ...get().checks, [provider]: IDLE } }),

  localScan: { status: "idle", models: [], message: null, scannedAt: null },

  scanLocal: async (baseUrl, apiKey) => {
    const target = (baseUrl ?? currentSettings().localBaseUrl).trim();
    set({
      localScan: { ...get().localScan, status: "scanning", message: null },
      checks: { ...get().checks, ollama: { ...get().checks.ollama, status: "checking", message: null } },
    });
    try {
      const models = await scanOllamaModels(target);
      const check: ProviderCheck = {
        status: "connected",
        models: models.map((model) => {
          const resolved = resolvePrice("ollama", model.id);
          return { id: model.id, label: model.id, price: resolved.price, priceSource: resolved.source === "custom" ? "local" : resolved.source };
        }),
        keySource: "local",
        message: null,
        checkedAt: Date.now(),
      };
      set({ localScan: { status: "done", models, message: null, scannedAt: Date.now() }, checks: { ...get().checks, ollama: check } });
      return check;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "El servidor local no respondió a /api/tags.";
      set({ localScan: { status: "fallback", models: [], message, scannedAt: Date.now() } });
      return get().verify("ollama", { baseUrl: target, ...(apiKey === undefined ? {} : { apiKey }) });
    }
  },
}));

async function requestModels(provider: AiProviderId, apiKey: string | undefined, baseUrl: string | undefined): Promise<ProviderCheck> {
  const checkedAt = Date.now();
  try {
    const response = await postJson("/api/v1/models/list", { provider, apiKey, baseUrl });
    const body = response.body;
    if (response.ok && typeof body === "object" && body !== null && "models" in body && Array.isArray(body.models)) {
      const keySource = "keySource" in body && isKeySource(body.keySource) ? body.keySource : null;
      const models = body.models.filter(isDiscoveredModel);
      return { status: "connected", models, keySource, message: null, checkedAt };
    }
    const error = readApiError(response, "El proveedor no devolvió su lista de modelos.");
    return { status: statusForError(error.code), models: [], keySource: null, message: error.message, checkedAt };
  } catch (error) {
    return { status: "error", models: [], keySource: null, message: networkErrorMessage(error, "No se pudo verificar la clave."), checkedAt };
  }
}

function statusForError(code: string | null): ProviderCheckStatus {
  if (code === "auth") return "auth_error";
  if (code === "quota") return "quota";
  if (code === "unconfigured") return "unconfigured";
  return "error";
}

/** Proveedores con clave válida verificada (o servidor local que respondió). */
export function connectedProviders(checks: Record<AiProviderId, ProviderCheck>): AiProviderId[] {
  return AI_PROVIDER_IDS.filter((id) => checks[id].status === "connected");
}

/** Modelos de un proveedor conectado, con la tarifa resuelta (el precio manual manda sobre el catálogo). */
export function selectableModels(provider: AiProviderId, check: ProviderCheck, overrides: PriceOverrides): SelectableModel[] {
  return check.models.map((model) => {
    const resolved = resolvePrice(provider, model.id, overrides);
    return { provider, id: model.id, label: model.label, price: resolved.price, priceSource: resolved.source };
  });
}

/** Hook: proveedores conectados con sus modelos listos para un selector. */
export function useConnectedModels(): { provider: AiProviderId; models: SelectableModel[] }[] {
  const checks = useProviderStatus((state) => state.checks);
  const prices = useAiSettings((state) => state.prices);
  return connectedProviders(checks).map((provider) => ({ provider, models: selectableModels(provider, checks[provider], prices) }));
}

/** true mientras alguna verificación esté en curso. */
export function useVerifying(): boolean {
  return useProviderStatus((state) => AI_PROVIDER_IDS.some((id) => state.checks[id].status === "checking"));
}

export function settingsHaveKey(settings: AiSettings, provider: AiProviderId): boolean {
  return !AI_PROVIDERS[provider].needsKey || isUsableKey(settings.keys[provider]);
}

function isKeySource(value: unknown): value is KeySource {
  return value === "browser" || value === "server" || value === "local";
}

function isDiscoveredModel(value: unknown): value is DiscoveredModel {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.label === "string";
}
