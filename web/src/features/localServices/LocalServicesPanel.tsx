"use client";

import { ExternalLink, Loader2, Plus, Radar, Zap } from "lucide-react";
import type { LocalService } from "@core/protocol";
import { COMPONENT_TEMPLATES } from "@/features/canvas/edit/components";
import { useCanvasEdits } from "@/features/canvas/edit/store";
import { BTN_SECONDARY, Badge } from "@/features/dashboard/ui";
import { usePlaygroundStore } from "@/features/playground/store";
import { currentSettings, pickSettings, useAiSettings } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import { actionsFor, type ServiceAction } from "./lib/suggestions";
import { useLocalServices, useLocalServicesSync } from "./store";

const ACTION_BUTTON =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-edge px-2 text-xs text-fg-2 hover:bg-panel-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";

function runAction(action: ServiceAction): void {
  switch (action.kind) {
    case "use-ollama":
      void useAiSettings.getState().save({ ...pickSettings(currentSettings()), localBaseUrl: action.url });
      return;
    case "use-endpoint": {
      const playground = usePlaygroundStore.getState();
      playground.setProfile("http");
      usePlaygroundStore.getState().setTargetUrl(action.url);
      return;
    }
    case "open":
      window.open(action.url, "_blank", "noopener,noreferrer");
      return;
    case "add-node":
      useCanvasEdits.getState().add(action.template, null);
      return;
  }
}

function ActionButton({ action, graphName }: { action: ServiceAction; graphName: string | null }) {
  switch (action.kind) {
    case "use-ollama":
      return (
        <button type="button" className={ACTION_BUTTON} onClick={() => runAction(action)} title="Guardar como URL del LLM local">
          <Zap className="size-3.5" aria-hidden />
          Usar como Ollama
        </button>
      );
    case "use-endpoint":
      return (
        <button type="button" className={ACTION_BUTTON} onClick={() => runAction(action)} title="Endpoint real del perfil HTTP en «Probar / Simular»">
          <Zap className="size-3.5" aria-hidden />
          Usar en Probar
        </button>
      );
    case "open":
      return (
        <button type="button" className={ACTION_BUTTON} onClick={() => runAction(action)}>
          <ExternalLink className="size-3.5" aria-hidden />
          Abrir
        </button>
      );
    case "add-node":
      return (
        <button
          type="button"
          className={ACTION_BUTTON}
          disabled={!graphName}
          onClick={() => runAction(action)}
          title={graphName ? `Añadir «${COMPONENT_TEMPLATES[action.template].label}» al lienzo de ${graphName}` : "Abre un pipeline en el lienzo primero"}
        >
          <Plus className="size-3.5" aria-hidden />
          Añadir nodo
        </button>
      );
  }
}

function ServiceRow({ service, graphName }: { service: LocalService; graphName: string | null }) {
  const actions = actionsFor(service);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-sm text-fg">
          <span className="truncate">{service.label}</span>
          <span className="font-mono text-xs text-fg-3">:{service.port}</span>
          {service.source === "docker" ? <Badge>Docker</Badge> : null}
        </span>
        {service.container || service.image ? (
          <span className="truncate font-mono text-[11px] text-fg-3" title={service.image}>
            {[service.container, service.image].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      {actions.length > 0 ? (
        <span className="flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <ActionButton key={action.kind} action={action} graphName={graphName} />
          ))}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Servicios locales detectados por la extensión (puertos conocidos de 127.0.0.1 y contenedores Docker):
 * sugiere nodos de infraestructura para el lienzo y rellena URLs base (Ollama, endpoint HTTP de prueba).
 */
export function LocalServicesPanel() {
  useLocalServicesSync();
  const result = useLocalServices((state) => state.result);
  const scanning = useLocalServices((state) => state.scanning);
  const error = useLocalServices((state) => state.error);
  const graphName = useCanvasEdits((state) => state.graphName);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-fg-3">
          <Radar className="size-3.5" aria-hidden /> Servicios locales detectados
          {result ? <span className="normal-case tracking-normal">· {new Date(result.scannedAt).toLocaleTimeString("es")}</span> : null}
        </h3>
        <button type="button" onClick={() => useLocalServices.getState().scan()} disabled={scanning} className={cn(BTN_SECONDARY, "h-8")}>
          {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Radar className="size-4" aria-hidden />}
          {scanning ? "Sondeando…" : result ? "Volver a sondear" : "Sondear"}
        </button>
      </div>
      <p className="text-xs text-fg-3">
        La extensión comprueba solo puertos conocidos de <span className="font-mono">127.0.0.1</span> (Ollama, Postgres, Redis, Kafka…) y, si
        hay Docker, los contenedores en marcha. Nada sale de tu máquina.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {result ? (
        result.services.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge px-3 py-3 text-center text-xs text-fg-3">
            No hay servicios conocidos escuchando{result.dockerAvailable ? "" : " (Docker no disponible)"}.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-edge rounded-lg border border-edge">
            {result.services.map((service) => (
              <ServiceRow key={service.id} service={service} graphName={graphName} />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
