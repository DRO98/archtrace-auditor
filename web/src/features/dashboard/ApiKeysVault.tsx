"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  RotateCw,
  Search,
  ShieldAlert,
  Sparkles,
  Unlock,
} from "lucide-react";
import { PROVIDER_SHORT, ProviderLogo } from "@/components/icons/providerLogos";
import { cn } from "@/lib/cn";
import { AI_PROVIDER_IDS, AI_PROVIDERS, OLLAMA_DEFAULT_URL, isUsableKey, keyWarning, modelLabel, type AiProviderId } from "@/lib/ai/catalog";
import { priceKey, type PriceSource, type TokenPrice } from "@/lib/ai/costEstimate";
import { describeLocalModel, ollamaTagsUrl } from "@/lib/ai/localScan";
import { selectableModels, useProviderStatus, type ProviderCheck, type SelectableModel } from "@/lib/ai/providerStatus";
import { currentSettings, modelFor, pickSettings, useAiSettings } from "@/lib/ai/settings";
import { useServerKeys } from "@/lib/ai/useServerKeys";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Badge, FIELD, Panel, PanelHeader } from "./ui";

/** Espera tras dejar de escribir antes de verificar la clave (listar modelos es gratis, pero no por pulsación). */
const VERIFY_DEBOUNCE_MS = 700;

const SOURCE_LABEL: Record<PriceSource, string> = {
  catalog: "catálogo",
  custom: "manual",
  local: "local",
  unknown: "sin tarifa",
};

function statusTone(check: ProviderCheck): { dot: string; label: string } {
  switch (check.status) {
    case "connected":
      return { dot: "bg-live shadow-[0_0_6px] shadow-live", label: "Conectado" };
    case "checking":
      return { dot: "animate-pulse bg-amber-400", label: "Verificando" };
    case "auth_error":
    case "quota":
    case "error":
      return { dot: "bg-rose-500", label: "Error" };
    default:
      return { dot: "bg-edge-strong", label: "Sin configurar" };
  }
}

/**
 * API & Integración: selector de proveedores arriba y, debajo, la tarjeta del elegido con su clave
 * (cifrada en este navegador), la verificación en vivo, los modelos detectados y su tarifa editable.
 */
export function ApiKeysVault() {
  const vault = useAiSettings((state) => state.vault);
  const vaultError = useAiSettings((state) => state.vaultError);
  const hydrated = useAiSettings((state) => state.hydrated);
  const activeProvider = useAiSettings((state) => state.provider);
  const checks = useProviderStatus((state) => state.checks);
  const [selected, setSelected] = useState<AiProviderId>(() => useAiSettings.getState().provider ?? "openai");
  const connected = AI_PROVIDER_IDS.filter((id) => checks[id].status === "connected").length;

  return (
    <div className="flex flex-col gap-4">
      <Panel as="div" className="grid gap-px overflow-hidden bg-edge sm:grid-cols-3">
        <SummaryCell label="Proveedor activo">
          {activeProvider ? (
            <span className="flex min-w-0 items-center gap-2">
              <ProviderLogo provider={activeProvider} className="size-5 rounded-md" />
              <span className="truncate">{PROVIDER_SHORT[activeProvider]}</span>
            </span>
          ) : (
            <span className="text-fg-2">Automático (.env)</span>
          )}
        </SummaryCell>
        <SummaryCell label="Proveedores conectados">
          <span className="font-mono">
            {connected}
            <span className="text-fg-3">/{AI_PROVIDER_IDS.length}</span>
          </span>
        </SummaryCell>
        <SummaryCell label="Almacenamiento de claves">
          {vault === "encrypted" ? (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <Lock className="size-3.5" aria-hidden /> AES-GCM · local
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-700">
              <Unlock className="size-3.5" aria-hidden /> Sin cifrar
            </span>
          )}
        </SummaryCell>
      </Panel>

      {vaultError ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
          <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {vaultError}
        </p>
      ) : null}

      <div role="tablist" aria-label="Proveedores de IA" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {AI_PROVIDER_IDS.map((id) => {
          const active = id === selected;
          const tone = statusTone(checks[id]);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(id)}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                active ? "border-brand/60 bg-brand/10 shadow-[0_0_0_1px] shadow-brand/30" : "border-edge bg-panel hover:border-edge-strong hover:bg-panel-2",
              )}
            >
              <ProviderLogo provider={id} className="size-8" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                  {PROVIDER_SHORT[id]}
                  {activeProvider === id ? <Sparkles className="size-3 shrink-0 text-brand-soft" aria-label="Proveedor activo" /> : null}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
                  <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
                  {tone.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {hydrated ? (
        <ProviderCard key={selected} provider={selected} />
      ) : (
        <Panel as="div" className="flex items-center gap-2 p-6 text-sm text-fg-3">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Descifrando claves…
        </Panel>
      )}
    </div>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-5 py-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-3">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center text-sm font-medium text-fg">{children}</div>
    </div>
  );
}

async function saveKey(provider: AiProviderId, apiKey: string, baseUrl: string): Promise<void> {
  const settings = currentSettings();
  const keys = { ...settings.keys };
  if (apiKey) keys[provider] = apiKey;
  else delete keys[provider];
  await useAiSettings.getState().save({
    ...pickSettings(settings),
    keys,
    localBaseUrl: AI_PROVIDERS[provider].needsKey ? settings.localBaseUrl : baseUrl,
  });
}

function ProviderCard({ provider }: { provider: AiProviderId }) {
  const info = AI_PROVIDERS[provider];
  const savedKey = useAiSettings((state) => state.keys[provider] ?? "");
  const savedBaseUrl = useAiSettings((state) => state.localBaseUrl);
  const activeProvider = useAiSettings((state) => state.provider);
  const check = useProviderStatus((state) => state.checks[provider]);
  const serverKeys = useServerKeys();
  const hasServerKey = serverKeys?.[provider] === true;

  const [key, setKey] = useState(savedKey);
  const [baseUrl, setBaseUrl] = useState(savedBaseUrl);
  const [reveal, setReveal] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // Ollama / Local: al seleccionarlo se escanean solos los modelos instalados (GET /api/tags), sin configurar nada.
  useEffect(() => {
    if (provider === "ollama") void useProviderStatus.getState().scanLocal(savedBaseUrl);
  }, [provider, savedBaseUrl]);

  const warning = info.needsKey ? keyWarning(provider, key) : null;
  const dirty = key.trim() !== savedKey || (!info.needsKey && baseUrl.trim() !== savedBaseUrl);
  const isActive = activeProvider === provider;

  /** Verifica el borrador; si la API lo acepta, se guarda cifrado. Una clave rechazada no se guarda. */
  async function verify(nextKey = key, nextBaseUrl = baseUrl): Promise<void> {
    const apiKey = nextKey.trim();
    const status = useProviderStatus.getState();
    const result =
      provider === "ollama"
        ? await status.scanLocal(nextBaseUrl.trim(), apiKey)
        : await status.verify(provider, { apiKey, baseUrl: nextBaseUrl.trim() });
    if (result.status === "connected") await saveKey(provider, apiKey, nextBaseUrl.trim());
  }

  function schedule(nextKey: string, nextBaseUrl: string): void {
    if (timer.current) window.clearTimeout(timer.current);
    // Vaciar la clave con una del servidor disponible también se verifica (con la del `.env`).
    const empty = nextKey.trim() === "";
    const ready = info.needsKey ? isUsableKey(nextKey) || (empty && hasServerKey) : true;
    if (!ready) {
      useProviderStatus.getState().reset(provider);
      return;
    }
    timer.current = window.setTimeout(() => void verify(nextKey, nextBaseUrl), VERIFY_DEBOUNCE_MS);
  }

  async function forget(): Promise<void> {
    setKey("");
    await saveKey(provider, "", savedBaseUrl);
    // Sin clave del navegador puede quedar la del servidor: se vuelve a verificar con ella.
    if (hasServerKey) void useProviderStatus.getState().verify(provider, { apiKey: "" });
    else useProviderStatus.getState().reset(provider);
  }

  function setActive(next: AiProviderId | null): void {
    void useAiSettings.getState().save({ ...pickSettings(currentSettings()), provider: next });
  }

  const credentialsRef = useRef<HTMLElement>(null);
  const [modelsMaxHeight, setModelsMaxHeight] = useState<number | undefined>();

  // En escritorio, «Modelos detectados» no puede superar la altura de la tarjeta de credenciales.
  useLayoutEffect(() => {
    const el = credentialsRef.current;
    if (!el) return;

    const sync = () => {
      const sideBySide = window.matchMedia("(min-width: 1024px)").matches;
      setModelsMaxHeight(sideBySide ? el.getBoundingClientRect().height : undefined);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [provider]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Panel ref={credentialsRef} aria-label={`Credenciales de ${info.label}`} className="flex flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProviderLogo provider={provider} className="size-10 rounded-xl" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-fg">{info.label}</h2>
              <p className="truncate font-mono text-[11px] text-fg-3">{info.keyHint ?? `${OLLAMA_DEFAULT_URL}`}</p>
            </div>
          </div>
          <StatusBadge check={check} onRetry={() => void verify()} />
        </header>

        <div className="flex flex-col gap-4 p-5">
          {info.needsKey ? (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
              API Key
              <span className="relative">
                <input
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasServerKey ? "Vacía = usar la clave del servidor (.env)" : `${info.keyPrefix ?? ""}…`}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    schedule(event.target.value, baseUrl);
                  }}
                  className={cn(FIELD, "pr-10 font-mono text-xs")}
                />
                <button
                  type="button"
                  aria-label={reveal ? "Ocultar clave" : "Mostrar clave"}
                  onClick={() => setReveal((value) => !value)}
                  className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-fg-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </span>
              {warning ? (
                <span className="flex gap-1 font-normal text-amber-700">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  {warning}
                </span>
              ) : null}
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
                Endpoint OpenAI-compatible
                <input
                  type="url"
                  spellCheck={false}
                  placeholder={OLLAMA_DEFAULT_URL}
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    schedule(key, event.target.value);
                  }}
                  className={cn(FIELD, "font-mono text-xs")}
                />
                <span className="font-normal text-fg-3">
                  Ollama <span className="font-mono">:11434/v1</span> · vLLM <span className="font-mono">:8000/v1</span>
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
                Clave (opcional, vLLM)
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    schedule(event.target.value, baseUrl);
                  }}
                  className={cn(FIELD, "font-mono text-xs")}
                />
              </label>
            </>
          )}

          {check.message && check.status !== "connected" ? (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 [overflow-wrap:anywhere]">
              {check.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void verify()}
              disabled={check.status === "checking" || (info.needsKey && !key.trim() && !hasServerKey)}
              className={BTN_PRIMARY}
            >
              {check.status === "checking" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}
              {dirty ? "Verificar y guardar" : "Verificar Conexión"}
            </button>
            {savedKey ? (
              <button type="button" onClick={() => void forget()} className={BTN_GHOST}>
                Borrar clave
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{isActive ? "Proveedor activo" : "Usar por defecto"}</p>
            <p className="text-xs text-fg-3">
              {isActive ? "Lecciones, chat y «Probar en vivo» usan este proveedor." : "Sustituye a la configuración automática del servidor (.env)."}
            </p>
          </div>
          {isActive ? (
            <button type="button" onClick={() => setActive(null)} className={BTN_SECONDARY}>
              Volver a automático
            </button>
          ) : (
            <button type="button" onClick={() => setActive(provider)} className={BTN_SECONDARY}>
              Activar
            </button>
          )}
        </div>
      </Panel>

      <ModelsPanel provider={provider} check={check} maxHeight={modelsMaxHeight} />
    </div>
  );
}

function StatusBadge({ check, onRetry }: { check: ProviderCheck; onRetry: () => void }) {
  const base = "group inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand";
  switch (check.status) {
    case "checking":
      return (
        <span role="status" className={cn(base, "border-edge bg-app-2 text-fg-2")}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Verificando…
        </span>
      );
    case "connected": {
      const source = check.keySource === "server" ? " · servidor" : check.keySource === "local" ? " · local" : "";
      return (
        <button type="button" onClick={onRetry} title="Volver a verificar" className={cn(base, "border-live/30 bg-live/10 text-emerald-700 hover:bg-live/20")}>
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          <span role="status" className="truncate">
            Conectado{source}
          </span>
          <RotateCw className="size-3 shrink-0 opacity-0 group-hover:opacity-70" aria-hidden />
        </button>
      );
    }
    case "auth_error":
    case "quota":
    case "error":
      return (
        <button type="button" onClick={onRetry} title="Volver a verificar" className={cn(base, "border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20")}>
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          <span role="status">{check.status === "auth_error" ? "Clave rechazada" : check.status === "quota" ? "Sin saldo" : "Sin conexión"}</span>
          <RotateCw className="size-3 shrink-0 opacity-0 group-hover:opacity-70" aria-hidden />
        </button>
      );
    default:
      return <span className={cn(base, "border-edge bg-app-2 text-fg-3")}>Sin configurar</span>;
  }
}

/** Modelos detectados en la API del proveedor, el modelo por defecto y la tarifa editable de cada uno. */
function ModelsPanel({ provider, check, maxHeight }: { provider: AiProviderId; check: ProviderCheck; maxHeight?: number }) {
  const prices = useAiSettings((state) => state.prices);
  const defaultModel = useAiSettings((state) => modelFor(state, provider));
  const localScan = useProviderStatus((state) => state.localScan);
  const localBaseUrl = useAiSettings((state) => state.localBaseUrl);
  const local = provider === "ollama";
  const localDetails = useMemo(() => new Map(localScan.models.map((model) => [model.id, describeLocalModel(model)])), [localScan.models]);
  const [filter, setFilter] = useState("");
  const models = useMemo(() => selectableModels(provider, check, prices), [provider, check, prices]);
  const needle = filter.trim().toLowerCase();
  const visible = needle ? models.filter((model) => model.id.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle)) : models;
  const missing = models.filter((model) => model.priceSource === "unknown").length;

  function chooseDefault(model: string): void {
    const settings = pickSettings(currentSettings());
    void useAiSettings.getState().save({ ...settings, models: { ...settings.models, [provider]: model } });
  }

  return (
    <Panel
      aria-labelledby="models-title"
      className="flex min-h-0 flex-col overflow-hidden"
      style={maxHeight !== undefined ? { maxHeight, height: maxHeight } : undefined}
    >
      <PanelHeader
        id="models-title"
        icon={KeyRound}
        title="Modelos detectados"
        description={
          local && localScan.status === "done"
            ? `${models.length} modelos instalados · detectados en ${ollamaTagsUrl(localBaseUrl) ?? "/api/tags"} · coste 0 $`
            : check.status === "connected"
              ? `${models.length} modelos · tarifa en USD por millón de tokens${missing > 0 ? ` · ${missing} sin tarifa` : ""}`
              : local
                ? "Escaneando el servidor local (Ollama /api/tags · vLLM /v1/models)…"
                : "Verifica la conexión para listar los modelos que sirve tu cuenta."
        }
        actions={
          models.length > 8 ? (
            <label className="relative">
              <span className="sr-only">Filtrar modelos</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                type="search"
                placeholder="Filtrar…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="h-8 w-40 rounded-lg border border-edge bg-panel pr-2.5 pl-8 font-mono text-xs text-fg placeholder:text-fg-3 focus:border-brand focus:outline-none"
              />
            </label>
          ) : local ? (
            <button
              type="button"
              onClick={() => void useProviderStatus.getState().scanLocal(localBaseUrl)}
              disabled={localScan.status === "scanning"}
              className={BTN_GHOST}
            >
              <RotateCw className={cn("size-3.5", localScan.status === "scanning" && "animate-spin")} aria-hidden />
              Reescanear
            </button>
          ) : null
        }
      />
      {local && localScan.status === "fallback" && check.status === "connected" ? (
        <p className="shrink-0 border-b border-edge px-5 py-2 text-[11px] text-fg-3">
          /api/tags no respondió ({localScan.message}); lista obtenida del endpoint OpenAI-compatible (vLLM).
        </p>
      ) : null}
      {check.status === "connected" && models.length > 0 ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[10px] uppercase tracking-wider text-fg-3">
              <tr className="border-b border-edge">
                <th className="px-5 py-2 font-medium">Modelo</th>
                <th className="w-24 px-2 py-2 font-medium">Input</th>
                <th className="w-24 px-2 py-2 font-medium">Output</th>
                <th className="w-24 px-5 py-2 font-medium">Origen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((model) => (
                // La tarifa en la clave: si cambia (precio manual quitado, nueva verificación) la fila se remonta con ella.
                <PriceRow
                  key={`${model.id}:${model.price?.input}:${model.price?.output}`}
                  model={model}
                  isDefault={model.id === defaultModel}
                  detail={local ? localDetails.get(model.id) : undefined}
                  onDefault={() => chooseDefault(model.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          {check.status === "checking" ? (
            <Loader2 className="size-5 animate-spin text-fg-3" aria-hidden />
          ) : (
            <>
              <span className="grid size-10 place-items-center rounded-xl border border-dashed border-edge-strong text-fg-3" aria-hidden>
                <PlugZap className="size-4" />
              </span>
              <p className="text-sm text-fg-2">Sin modelos detectados</p>
              <p className="max-w-xs text-xs text-fg-3">
                Por defecto: <span className="font-mono text-fg-2">{modelLabel(provider, defaultModel)}</span>. Al conectar verás aquí todos los modelos
                de tu cuenta con su tarifa.
              </p>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function PriceRow({ model, isDefault, detail, onDefault }: { model: SelectableModel; isDefault: boolean; detail?: string; onDefault: () => void }) {
  const [input, setInput] = useState(formatRate(model.price?.input));
  const [output, setOutput] = useState(formatRate(model.price?.output));

  function commit(nextInput: string, nextOutput: string): void {
    const parsed = parsePrice(nextInput, nextOutput);
    if (!parsed && model.priceSource !== "custom") {
      // Vaciar una tarifa de catálogo no la borra: se vuelve a mostrar.
      setInput(formatRate(model.price?.input));
      setOutput(formatRate(model.price?.output));
      return;
    }
    const settings = currentSettings();
    const key = priceKey(model.provider, model.id);
    const same = parsed && model.price && parsed.input === model.price.input && parsed.output === model.price.output;
    if (same) return;
    const prices = { ...settings.prices };
    if (parsed) prices[key] = parsed;
    else delete prices[key];
    void useAiSettings.getState().save({ ...pickSettings(settings), prices });
  }

  function resetOverride(): void {
    const settings = currentSettings();
    const prices = { ...settings.prices };
    delete prices[priceKey(model.provider, model.id)];
    void useAiSettings.getState().save({ ...pickSettings(settings), prices });
  }

  const cell = "h-7 w-full rounded-md border border-edge bg-panel px-1.5 text-right font-mono text-xs text-fg focus:border-brand focus:outline-none";
  return (
    <tr className={cn("group border-b border-edge/60 last:border-0", isDefault ? "bg-brand/5" : "hover:bg-panel-2/50")}>
      <td className="max-w-0 px-5 py-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate" title={model.id}>
            <span className="block truncate font-mono text-fg">{model.id}</span>
            {detail ? <span className="block truncate text-[10px] text-fg-3">{detail}</span> : null}
          </span>
          {isDefault ? (
            <Badge tone="brand">Por defecto</Badge>
          ) : (
            <button type="button" onClick={onDefault} className="shrink-0 text-[11px] text-fg-3 opacity-0 hover:text-brand-soft group-hover:opacity-100 focus:opacity-100">
              Usar
            </button>
          )}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <input
          inputMode="decimal"
          aria-label={`Coste input de ${model.id} por millón de tokens`}
          placeholder="—"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onBlur={() => commit(input, output)}
          className={cell}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          inputMode="decimal"
          aria-label={`Coste output de ${model.id} por millón de tokens`}
          placeholder="—"
          value={output}
          onChange={(event) => setOutput(event.target.value)}
          onBlur={() => commit(input, output)}
          className={cell}
        />
      </td>
      <td className="px-5 py-1.5">
        {model.priceSource === "custom" ? (
          <button type="button" onClick={resetOverride} title="Quitar precio manual" className="text-brand-soft underline-offset-2 hover:underline">
            manual ×
          </button>
        ) : (
          <span className={cn(model.priceSource === "unknown" ? "text-amber-700" : "text-fg-3")}>{SOURCE_LABEL[model.priceSource]}</span>
        )}
      </td>
    </tr>
  );
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** Ambos campos vacíos → sin precio manual. Uno vacío cuenta como 0 (p. ej. embeddings sin salida). */
function parsePrice(input: string, output: string): TokenPrice | null {
  if (!input.trim() && !output.trim()) return null;
  const read = (text: string): number => {
    const value = Number.parseFloat(text.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return { input: read(input), output: read(output) };
}
