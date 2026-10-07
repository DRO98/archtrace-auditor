"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@xyflow/react";
import { Check, Code2, Copy, Download, FileCode2, X } from "lucide-react";
import { siPython, siTypescript } from "simple-icons";
import { BrandIcon } from "@/components/icons/BrandIcon";
import { downloadText } from "@/lib/download";
import { cn } from "@/lib/cn";
import { AI_PROVIDERS, AI_PROVIDER_IDS, isProviderId, type AiProviderId } from "@/lib/ai/catalog";
import { modelFor, readSettings, useAiSettings } from "@/lib/ai/settings";
import { usePlaygroundStore } from "@/features/playground/store";
import { useCanvasStore } from "../store";
import { ARCHITECTURE_KIND_INFO } from "../lib/architectureKind";
import {
  SERVICE_TEMPLATES,
  SERVICE_TEMPLATE_IDS,
  buildServiceSpec,
  generateServiceCode,
  type ServiceTemplateId,
} from "../lib/serviceExporter";
import { useArchitectureKind } from "../lib/useArchitectureKind";
import {
  EMBEDDER_KINDS,
  EMBEDDER_LABELS,
  STAGE_LABELS,
  buildCodeExportSpec,
  codeFilename,
  defaultCodeExportOptions,
  defaultEmbedder,
  generateCode,
  type CodeExportOptions,
  type CodeLanguage,
  type EmbedderKind,
} from "../lib/codeExporter";
import { projectSlug } from "./ExportDocsModal";

const TABS: readonly { id: CodeLanguage; label: string; mime: string; brand: typeof siPython }[] = [
  { id: "python", label: "Python", mime: "text/x-python", brand: siPython },
  { id: "typescript", label: "TypeScript / Node.js", mime: "text/typescript", brand: siTypescript },
];

/** "rag" = la muestra RAG (con proveedor, embedder…); el resto, plantillas de servicio agnósticas. */
type TemplateChoice = "rag" | ServiceTemplateId;

const TEMPLATE_GROUPS: readonly { label: string; ids: readonly TemplateChoice[] }[] = [
  { label: "Microservicios / APIs HTTP", ids: SERVICE_TEMPLATE_IDS.filter((id) => SERVICE_TEMPLATES[id].family === "http") },
  { label: "Eventos / Streaming", ids: SERVICE_TEMPLATE_IDS.filter((id) => SERVICE_TEMPLATES[id].family === "event") },
  { label: "RAG / IA", ids: ["rag"] },
];

function templateLabel(choice: TemplateChoice): string {
  return choice === "rag" ? "Pipeline RAG (Python / TypeScript)" : SERVICE_TEMPLATES[choice].label;
}

const TOAST_MS = 2500;
const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400";
const LABEL = "text-xs font-semibold text-slate-500";

/** Proveedor inicial: el elegido en Ajustes; si no, el que usa "Probar en vivo" sobre este lienzo. */
function initialOptions(): CodeExportOptions {
  const state = useAiSettings.getState();
  const settings = state.hydrated ? state : readSettings();
  const playground = usePlaygroundStore.getState();
  const provider: AiProviderId = settings.provider ?? playground.provider;
  const model = settings.provider ? modelFor(settings, provider) : playground.model;
  return defaultCodeExportOptions(provider, model);
}

export function ExportCodeModal({ onClose }: { onClose: () => void }) {
  const graph = useCanvasStore((state) => state.graph);
  const edges = useStore((state) => state.edges);
  const { kind } = useArchitectureKind();
  const [template, setTemplate] = useState<TemplateChoice>(() => ARCHITECTURE_KIND_INFO[kind].template ?? "rag");
  const [language, setLanguage] = useState<CodeLanguage>("python");
  const [options, setOptions] = useState<CodeExportOptions>(initialOptions);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const spec = useMemo(
    () =>
      buildCodeExportSpec(
        {
          projectName: graph?.projectName ?? "Proyecto",
          modules: graph?.modules.map(({ id, label, filePath }) => ({ id, label, filePath })) ?? [],
          edges,
        },
        options,
      ),
    [graph, edges, options],
  );
  const serviceSpec = useMemo(
    () => (graph ? buildServiceSpec(graph) : buildServiceSpec({ version: 1, projectName: "Proyecto", groups: [], modules: [], edges: [] })),
    [graph],
  );
  const slug = projectSlug(graph?.projectName);
  const isRag = template === "rag";
  const filename = isRag ? codeFilename(language, slug) : SERVICE_TEMPLATES[template].filename(slug);
  const code = useMemo(
    () => (template === "rag" ? generateCode(language, spec, filename) : generateServiceCode(template, serviceSpec)),
    [template, language, spec, serviceSpec, filename],
  );
  const tab = TABS.find((item) => item.id === language) ?? TABS[0];
  const mime = isRag ? tab.mime : SERVICE_TEMPLATES[template].mime;
  const extension = filename.slice(filename.lastIndexOf(".") + 1);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  function notify(text: string, tone: "ok" | "error" = "ok"): void {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      notify("Código copiado al portapapeles");
    } catch {
      notify("El navegador no permitió copiar. Usa el botón de descarga.", "error");
    }
  }

  function download(): void {
    downloadText(filename, code, mime);
    notify(`Descargado ${filename}`);
  }

  function patch(next: Partial<CodeExportOptions>): void {
    setOptions((current) => ({ ...current, ...next }));
  }

  function changeProvider(provider: AiProviderId): void {
    // El embedder sigue al proveedor solo mientras nadie lo haya cambiado a mano.
    setOptions((current) => ({
      ...current,
      provider,
      model: AI_PROVIDERS[provider].models[0]?.id ?? "",
      embedder: current.embedder === defaultEmbedder(current.provider) ? defaultEmbedder(provider) : current.embedder,
    }));
  }

  const models = AI_PROVIDERS[options.provider].models;
  const customModel = !models.some((item) => item.id === options.model);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 sm:p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-code-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Code2 className="size-5 shrink-0 text-slate-600" aria-hidden />
            <h2 id="export-code-title" className="truncate text-base font-semibold text-slate-900">
              Exportar Código
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            <FieldCard label="Plantilla">
              <select className={FIELD} value={template} onChange={(event) => setTemplate(event.target.value as TemplateChoice)}>
                {TEMPLATE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.ids.map((id) => (
                      <option key={id} value={id}>
                        {templateLabel(id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </FieldCard>

            {isRag ? (
              <>
                <section aria-label="Etapas detectadas" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Lienzo:</span>
                  {spec.stages.length === 0 ? (
                    <span>no se reconocen etapas RAG; se genera solo la llamada al LLM.</span>
                  ) : (
                    spec.stages.map((item) => (
                      <span key={item.stage} title={item.filePath} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
                        {STAGE_LABELS[item.stage]} · <span className="font-medium">{item.label}</span>
                      </span>
                    ))
                  )}
                </section>

                <section aria-label="Parámetros" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FieldCard label="Proveedor">
                    <select
                      className={FIELD}
                      value={options.provider}
                      onChange={(event) => {
                        if (isProviderId(event.target.value)) changeProvider(event.target.value);
                      }}
                    >
                      {AI_PROVIDER_IDS.map((id) => (
                        <option key={id} value={id}>
                          {AI_PROVIDERS[id].label}
                        </option>
                      ))}
                    </select>
                  </FieldCard>
                  <FieldCard label="Modelo">
                    <select className={FIELD} value={options.model} onChange={(event) => patch({ model: event.target.value })}>
                      {customModel ? <option value={options.model}>{options.model}</option> : null}
                      {models.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </FieldCard>
                  {spec.retrieval ? (
                    <>
                      <FieldCard label="Embedder">
                        <select
                          className={FIELD}
                          value={options.embedder}
                          onChange={(event) => patch({ embedder: event.target.value as EmbedderKind })}
                        >
                          {EMBEDDER_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {EMBEDDER_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                      </FieldCard>
                      <NumberField label="Tamaño de ventana" value={options.chunkSize} min={1} onChange={(chunkSize) => patch({ chunkSize })} />
                      <NumberField
                        label="Solapamiento"
                        value={options.chunkOverlap}
                        min={0}
                        max={Math.max(0, options.chunkSize - 1)}
                        onChange={(chunkOverlap) => patch({ chunkOverlap })}
                      />
                      <NumberField label="Top-k" value={options.topK} min={1} onChange={(topK) => patch({ topK })} />
                    </>
                  ) : null}
                </section>

                <div role="tablist" aria-label="Lenguaje" className="flex gap-1 border-b border-slate-200">
                  {TABS.map((item) => {
                    const selected = item.id === language;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setLanguage(item.id)}
                        className={cn(
                          "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                          selected
                            ? "border-teal-600 text-slate-900"
                            : "border-transparent text-slate-500 hover:text-slate-800",
                        )}
                      >
                        <BrandIcon icon={item.brand} className="size-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <ServiceSummary templateId={template} spec={serviceSpec} />
            )}

            <div
              role="tabpanel"
              aria-label={isRag ? tab.label : SERVICE_TEMPLATES[template].label}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <FileCode2 className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                <p className="truncate font-mono text-xs font-medium text-slate-700">{filename}</p>
              </div>
              <pre
                tabIndex={0}
                aria-label={`Vista previa de ${filename}`}
                className="max-h-[min(40vh,22rem)] overflow-auto bg-slate-50/80 p-3 font-mono text-xs leading-5 text-slate-800"
              >
                {code}
              </pre>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3.5">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <Copy className="mr-2 size-4" aria-hidden />
            Copiar código
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Download className="mr-2 size-4" aria-hidden />
            Descargar .{extension}
          </button>
        </footer>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center">
        {toast ? (
          <div
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg",
              toast.tone === "error" ? "bg-rose-600" : "bg-slate-900",
            )}
          >
            {toast.tone === "ok" ? <Check className="size-4 text-emerald-400" aria-hidden /> : null}
            {toast.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Campo etiquetado en tarjeta: evita que el select quede pegado al borde o cortado. */
function FieldCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/** Lo que la plantilla de servicio leyó del lienzo: endpoints, dependencias y topics. */
function ServiceSummary({ templateId, spec }: { templateId: ServiceTemplateId; spec: ReturnType<typeof buildServiceSpec> }) {
  const family = SERVICE_TEMPLATES[templateId].family;
  const chips =
    family === "http"
      ? [
          ...spec.endpoints.map((item) => ({ key: `e:${item.path}`, text: `POST ${item.path}`, title: item.filePath })),
          ...spec.dependencies.map((item) => ({ key: `d:${item.id}`, text: `${item.label} · ${item.kind}`, title: item.filePath })),
        ]
      : [
          ...spec.topics.map((item) => ({
            key: `t:${item.name}`,
            text: `topic ${item.name}`,
            title: `${item.producers.length} productor(es) · ${item.consumers.length} consumidor(es)`,
          })),
          ...spec.streamJobs.map((item) => ({ key: `j:${item.filePath}`, text: `job ${item.label}`, title: item.filePath })),
        ];
  return (
    <section aria-label="Detectado en el lienzo" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span className="font-semibold text-slate-700">Lienzo:</span>
      {chips.length === 0 ? (
        <span>{family === "http" ? "no hay módulos API; se genera un endpoint de ejemplo." : "no hay topics ni jobs; se genera un ejemplo."}</span>
      ) : (
        chips.map((chip) => (
          <span key={chip.key} title={chip.title} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">
            {chip.text}
          </span>
        ))
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <FieldCard label={label}>
      <input
        type="number"
        className={FIELD}
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </FieldCard>
  );
}
