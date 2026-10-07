"use client";

import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, RotateCw } from "lucide-react";
import { AI_PROVIDER_IDS, AI_PROVIDERS, isProviderId, keyWarning, selectionLabel, type AiProviderId } from "@/lib/ai/catalog";
import { selectableModels, useProviderStatus } from "@/lib/ai/providerStatus";
import { currentSettings, modelFor, pickSettings, selectionFor, useAiSettings, type AiSettings } from "@/lib/ai/settings";
import { useServerKeys } from "@/lib/ai/useServerKeys";
import type { AiSelection } from "@/lib/ai/types";
import { networkErrorMessage, postJson, readApiError } from "@/lib/http";
import { FIELD_CLASS } from "../theme";

type KeySource = "browser" | "server" | "local";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; label: string; latencyMs: number; keySource: KeySource | null }
  | { status: "error"; message: string; latencyMs: number };

const KEY_SOURCE_LABEL: Record<KeySource, string> = {
  browser: "clave de Ajustes",
  server: "clave de servidor",
  local: "local, sin clave",
};

const ENV_OPTION = "env";

const FIELD = `${FIELD_CLASS} h-9 px-2.5`;

/** Proveedor, modelo y clave del proveedor activo. Se edita un borrador y se guarda en `localStorage`. */
export function AiSettingsSection() {
  const ids = useId();
  // El modal se monta al abrirse, en cliente: el borrador parte de lo guardado.
  const [draft, setDraft] = useState<AiSettings>(() => pickSettings(currentSettings()));
  const [reveal, setReveal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const serverKeys = useServerKeys();

  const provider = draft.provider;
  const info = provider ? AI_PROVIDERS[provider] : null;
  const model = provider ? modelFor(draft, provider) : "";
  const check = useProviderStatus((state) => (provider ? state.checks[provider] : null));
  // Con la clave verificada, los modelos que el proveedor sirve de verdad; si no, los del catálogo.
  const models = provider && check?.status === "connected" && check.models.length > 0
    ? selectableModels(provider, check, draft.prices)
    : info ? info.models : [];
  const customModel = info && !models.some((item) => item.id === model);
  const warning = provider && info?.needsKey ? keyWarning(provider, draft.keys[provider]) : null;
  const hasServerKey = provider !== null && serverKeys?.[provider] === true;

  function update(next: Partial<AiSettings>): void {
    setDraft((current) => ({ ...current, ...next }));
    setNotice(null);
    setTest({ status: "idle" });
  }

  /** Prueba el borrador (sin guardarlo) con una llamada mínima al proveedor. */
  async function testConnection(): Promise<void> {
    setTest({ status: "testing" });
    const startedAt = performance.now();
    const elapsed = (): number => Math.round(performance.now() - startedAt);
    const ai: AiSelection | undefined = provider ? selectionFor(draft, provider, model) : undefined;
    try {
      const response = await postJson("/api/ai/verify", { ai });
      const body = response.body;
      if (response.ok && typeof body === "object" && body !== null && "provider" in body && isProviderId(body.provider)) {
        const resolvedModel = "model" in body && typeof body.model === "string" ? body.model : "";
        // Latencia medida por el servidor (solo la llamada al proveedor); si falta, la del viaje completo.
        const latencyMs = "latencyMs" in body && typeof body.latencyMs === "number" ? Math.round(body.latencyMs) : elapsed();
        const keySource = "keySource" in body && isKeySource(body.keySource) ? body.keySource : null;
        setTest({ status: "ok", label: selectionLabel(body.provider, resolvedModel), latencyMs, keySource });
        return;
      }
      setTest({ status: "error", message: readApiError(response, "No se pudo verificar la conexión.").message, latencyMs: elapsed() });
    } catch (error) {
      setTest({ status: "error", message: networkErrorMessage(error, "No se pudo verificar la conexión."), latencyMs: elapsed() });
    }
  }

  function setKey(id: AiProviderId, value: string): void {
    update({ keys: { ...draft.keys, [id]: value } });
  }

  function save(): void {
    // Las claves y tarifas se editan también en el vault: se parte de lo último guardado y solo se toca
    // la clave del proveedor elegido aquí.
    const saved = pickSettings(currentSettings());
    const keys = { ...saved.keys };
    const draftKey = provider ? draft.keys[provider]?.trim() : undefined;
    if (provider && draftKey) keys[provider] = draftKey;
    else if (provider) delete keys[provider];
    void useAiSettings.getState().save({ ...saved, provider: draft.provider, models: draft.models, keys });
    if (provider) void useProviderStatus.getState().verify(provider, { apiKey: draftKey ?? "" });
    setNotice(useAiSettings.getState().vault === "encrypted" ? "Guardado (cifrado) en este navegador." : "Guardado en este navegador.");
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h3 id={`${ids}-title`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Proveedor de IA
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Proveedor
          <select
            value={provider ?? ENV_OPTION}
            onChange={(event) => update({ provider: isProviderId(event.target.value) ? event.target.value : null })}
            className={FIELD}
          >
            <option value={ENV_OPTION}>Automático (.env)</option>
            {AI_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {AI_PROVIDERS[id].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Modelo
          <select
            value={model}
            disabled={!provider}
            onChange={(event) => provider && update({ models: { ...draft.models, [provider]: event.target.value } })}
            className={FIELD}
          >
            {!provider ? <option value="">El del .env</option> : null}
            {customModel ? <option value={model}>{model}</option> : null}
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {provider && info?.needsKey ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Clave de {info.label}
          <span className="relative">
            <input
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={hasServerKey ? "Vacía = usar la clave del servidor" : "Pega aquí tu clave"}
              value={draft.keys[provider] ?? ""}
              onChange={(event) => setKey(provider, event.target.value)}
              className={`${FIELD} pr-10 font-mono`}
            />
            <button
              type="button"
              aria-label={reveal ? "Ocultar clave" : "Mostrar clave"}
              onClick={() => setReveal((value) => !value)}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-teal-500"
            >
              {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </span>
          {warning ? (
            <span role="status" className="flex gap-1 text-amber-700">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              {warning}
            </span>
          ) : null}
          {hasServerKey && !draft.keys[provider]?.trim() ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-slate-500">
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
              Clave del servidor activa (no es necesario añadir otra)
            </span>
          ) : null}
        </label>
      ) : null}

      {provider === "ollama" ? (
        <p className="text-xs text-slate-500">
          Sin clave: necesita <span className="font-mono">ollama serve</span> en local.
        </p>
      ) : null}

      {test.status === "ok" || test.status === "error" ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => void testConnection()}
            title="Volver a probar la conexión"
            className={
              test.status === "ok"
                ? "group inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 transition-all hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-teal-500 active:scale-[0.98]"
                : "group inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 transition-all hover:border-rose-300 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-teal-500 active:scale-[0.98]"
            }
          >
            {test.status === "ok" ? (
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            )}
            <span role="status" className="truncate">
              {test.status === "ok"
                ? `Conectado · ${test.label} · ${formatMs(test.latencyMs)}${test.keySource ? ` · ${KEY_SOURCE_LABEL[test.keySource]}` : ""}`
                : `Sin conexión · ${formatMs(test.latencyMs)}`}
            </span>
            <RotateCw className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden />
          </button>
          {test.status === "error" ? (
            <p role="alert" className="text-xs text-rose-700 [overflow-wrap:anywhere]">
              {test.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {notice ? (
          <span role="status" className="text-xs text-slate-600">
            {notice}
          </span>
        ) : null}
        {provider && info?.needsKey && draft.keys[provider] ? (
          <button
            type="button"
            onClick={() => setKey(provider, "")}
            className="h-8 rounded-lg px-3 text-sm text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98]"
          >
            Borrar clave
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={test.status === "testing"}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900 hover:shadow-md hover:shadow-slate-500/10 focus-visible:outline-2 focus-visible:outline-teal-500 active:scale-[0.98] disabled:opacity-60"
        >
          {test.status === "testing" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Probar conexión
        </button>
        <button
          type="button"
          onClick={save}
          className="h-8 rounded-lg bg-gradient-to-r from-teal-600 to-teal-600 px-4 text-sm font-medium text-white shadow-sm transition-all hover:from-teal-500 hover:to-teal-500 hover:shadow-lg hover:shadow-teal-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 active:scale-[0.98]"
        >
          Guardar
        </button>
      </div>
    </section>
  );
}

function isKeySource(value: unknown): value is KeySource {
  return value === "browser" || value === "server" || value === "local";
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
