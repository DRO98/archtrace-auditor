"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cable, Check, Code2, Cpu, Trash2, Zap } from "lucide-react";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { probeFromNode } from "@/features/playground/hooks/usePlaygroundTrace";
import { usePlaygroundStore } from "@/features/playground/store";
import { useProviderStatus } from "@/lib/ai/providerStatus";
import { cn } from "@/lib/cn";
import { exploreCode } from "../lib/actions";
import { COMPONENT_TEMPLATE_IDS, COMPONENT_TEMPLATES, findComponent, isCanvasComponent } from "./components";
import { insertComponent } from "./ComponentPalette";
import { llmModelGroups, type LlmModelOption } from "./llmModels";
import { NotesSection } from "./NotesSection";
import { useCanvasEdits } from "./store";

const ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none disabled:opacity-40";
const SECTION = "px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3";
const MARGIN = 8;

/** Asigna el modelo al nodo LLM: lo usa "Probar en vivo" y queda guardado con el pipeline. */
export function assignLlmModel(option: LlmModelOption): void {
  const playground = usePlaygroundStore.getState();
  if (playground.status !== "running") {
    playground.setProvider(option.provider);
    playground.setModel(option.model);
  }
  useCanvasEdits.getState().setLlm({ provider: option.provider, model: option.model });
}

/**
 * Menú de clic derecho de un nodo: notas de arquitectura del nodo; en el nodo LLM, cambiar el modelo asignado
 * entre los proveedores BYOK y los modelos locales detectados; en un componente añadido, quitarlo.
 */
export function NodeContextMenu({ labelOf, llmNodeId, demo }: { labelOf: (id: string) => string | null; llmNodeId: string | null; demo: boolean }) {
  const menu = useCanvasEdits((state) => state.menu);
  const components = useCanvasEdits((state) => state.components);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => useCanvasEdits.getState().closeMenu();
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Se mide tras montar para que el menú no se salga de la ventana cerca de los bordes.
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(menu.y, window.innerHeight - height - MARGIN)),
    });
  }, [menu]);

  if (!menu) return null;
  const label = labelOf(menu.nodeId);
  if (label === null) return null;
  const virtual = isCanvasComponent(menu.nodeId);
  const isLlm = menu.nodeId === llmNodeId;
  const close = (): void => useCanvasEdits.getState().closeMenu();
  const component = virtual ? findComponent(components, menu.nodeId) : undefined;
  const spliceTarget = component?.detached && component.before ? labelOf(component.before) : null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Acciones de ${label}`}
      style={position ?? { left: menu.x, top: menu.y, visibility: "hidden" }}
      className="fixed z-[60] flex max-h-[min(40rem,calc(100dvh-1rem))] w-80 flex-col overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-xl"
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="truncate border-b border-line px-2 pt-1 pb-2 text-xs font-semibold text-ink">{label}</p>
      {virtual ? null : (
        <button
          type="button"
          role="menuitem"
          className={ITEM}
          onClick={() => {
            exploreCode(menu.nodeId);
            close();
          }}
        >
          <Code2 className="size-4 text-ink-2" aria-hidden />
          Abrir en el editor
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={ITEM}
        onClick={() => {
          probeFromNode(menu.nodeId);
          close();
        }}
      >
        <Zap className="size-4 text-ink-2" aria-hidden />
        Probar desde este nodo
      </button>
      {component?.detached ? (
        <button
          type="button"
          role="menuitem"
          className={cn(ITEM, "font-medium text-teal-800 hover:bg-teal-50")}
          title="Conecta el componente en el flujo: las entradas del nodo destino pasan por él"
          onClick={() => useCanvasEdits.getState().splice(menu.nodeId, spliceTarget ? undefined : (llmNodeId ?? null))}
        >
          <Cable className="size-4" aria-hidden />
          <span className="min-w-0 truncate">Empalmar en el flujo{spliceTarget ? ` · antes de «${spliceTarget}»` : ""}</span>
        </button>
      ) : null}
      {virtual ? (
        <button type="button" role="menuitem" className={cn(ITEM, "text-rose-700 hover:bg-rose-50")} onClick={() => useCanvasEdits.getState().remove(menu.nodeId)}>
          <Trash2 className="size-4" aria-hidden />
          Quitar componente
        </button>
      ) : null}

      <NotesSection nodeId={menu.nodeId} sectionClassName={SECTION} />

      {isLlm ? <LlmModelSection demo={demo} onPicked={close} /> : null}

      <p className={SECTION}>Insertar antes</p>
      <div className="flex flex-wrap gap-1 px-2 pb-2">
        {COMPONENT_TEMPLATE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            title={COMPONENT_TEMPLATES[id].description}
            onClick={() => {
              insertComponent(id, menu.nodeId);
              close();
            }}
            className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-ink-2 hover:bg-teal-100 hover:text-teal-800"
          >
            {COMPONENT_TEMPLATES[id].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LlmModelSection({ demo, onPicked }: { demo: boolean; onPicked: () => void }) {
  const checks = useProviderStatus((state) => state.checks);
  const provider = usePlaygroundStore((state) => state.provider);
  const model = usePlaygroundStore((state) => state.model);
  const running = usePlaygroundStore((state) => state.status === "running");
  const groups = llmModelGroups(checks);

  return (
    <>
      <p className={cn(SECTION, "mt-1 border-t border-line")}>
        <Cpu className="mr-1 inline size-3 align-[-1px]" aria-hidden />
        Modelo del LLM
      </p>
      {demo ? <p className="px-2 pb-1 text-[11px] text-ink-3">En la demo la respuesta está grabada: el modelo se aplica al salir de ella.</p> : null}
      {running ? <p className="px-2 pb-1 text-[11px] text-amber-700">Hay una consulta en curso: el cambio se aplicará a la siguiente.</p> : null}
      {groups.map((group) => (
        <div key={group.provider} className="flex flex-col">
          <p className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px] font-medium text-ink-2">
            {group.label}
            {group.verified ? null : <span className="font-normal text-ink-3">· sin verificar</span>}
          </p>
          {group.options.map((option) => {
            const current = option.provider === provider && option.model === model;
            return (
              <button
                key={`${option.provider}:${option.model}`}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={cn(ITEM, "py-1 pl-4 text-xs", current && "font-semibold text-teal-800")}
                onClick={() => {
                  assignLlmModel(option);
                  onPicked();
                }}
              >
                <span className="grid size-3.5 shrink-0 place-items-center">{current ? <Check className="size-3.5" aria-hidden /> : null}</span>
                <span className="min-w-0 flex-1 truncate" title={option.model}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <Link href={DASHBOARD_ROUTES.api} className="mx-2 my-1.5 text-[11px] text-teal-700 underline">
        Gestionar claves y modelos locales
      </Link>
    </>
  );
}
