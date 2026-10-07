"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Container, Cpu, FolderGit2, MonitorSmartphone, Network, Radar, RefreshCw } from "lucide-react";
import { BuyProButton, LicenseForm } from "@/features/billing/Paywall";
import { FREE_FEATURES, PRO_FEATURES, PRO_PERIOD, PRO_PRICE } from "@/features/billing/plans";
import { FREE_REPO_LIMIT, quotaStatus } from "@/features/billing/quota";
import { useBilling, useBillingHydration } from "@/features/billing/store";
import { IDE_OPTIONS, shortenPath, type IdeId } from "@/features/canvas/lib/ideSetup";
import { useIdeSetup } from "@/features/canvas/lib/useIdeSetup";
import { useCanvasStore } from "@/features/canvas/store";
import { LocalServicesPanel } from "@/features/localServices/LocalServicesPanel";
import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { OLLAMA_DEFAULT_URL } from "@/lib/ai/catalog";
import { useAiSettings } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import type { ConnectionStatus } from "@/lib/ws/TeacherSocketManager";
import { PageShell } from "../PageShell";
import { BTN_PRIMARY, BTN_SECONDARY, Badge, Metric, Panel, PanelHeader, Switch, type BadgeTone } from "../ui";

const WS_URL = process.env.NEXT_PUBLIC_TEACHER_WS_URL ?? "ws://127.0.0.1:8080";

const STATUS: Record<ConnectionStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Conectado", tone: "live" },
  connecting: { label: "Conectando…", tone: "amber" },
  closed: { label: "Desconectado", tone: "rose" },
};

export function SettingsView({ initialLicense }: { initialLicense?: string }) {
  return (
    <PageShell title="Ajustes y Plan" description="Tu suscripción y el entorno local de ejecución.">
      <PlansSection initialLicense={initialLicense} />
      <EnvironmentSection />
    </PageShell>
  );
}

type Activation = { phase: "checking" } | { phase: "done" } | { phase: "error"; message: string };

/**
 * Free / Pro con el estado real de este navegador: cuota de repos usada y licencia activa. `initialLicense` llega
 * de la página de confirmación del pago (`/?license=…` → aquí) y se valida sola una vez.
 */
function PlansSection({ initialLicense }: { initialLicense?: string }) {
  const router = useRouter();
  const hydrated = useBillingHydration();
  const license = useBilling((state) => state.license);
  const imported = useBilling((state) => state.imported);
  const pro = license !== null;
  const quota = quotaStatus(imported, pro);
  const [activation, setActivation] = useState<Activation | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!initialLicense || started.current) return;
    started.current = true;
    // La clave no se queda en la URL (historial, capturas de pantalla).
    router.replace(window.location.pathname);
    setActivation({ phase: "checking" });
    void useBilling
      .getState()
      .activate(initialLicense)
      .then((result) => setActivation(result.ok ? { phase: "done" } : { phase: "error", message: result.error }));
  }, [initialLicense, router]);

  return (
    <section aria-labelledby="plans-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="plans-title" className="text-sm font-semibold text-fg">
          Plan
        </h2>
        <p className="text-xs text-fg-3">AI usage is billed by your own provider (or free with local models). We never see your code.</p>
      </div>
      {activation ? (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            activation.phase === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-700" : "border-live/30 bg-live/10 text-fg",
          )}
        >
          {activation.phase === "checking"
            ? "Verifying your license…"
            : activation.phase === "done"
              ? "Pro is active. Thanks for supporting ArchTrace!"
              : activation.message}
        </p>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        <li className={cn("flex flex-col rounded-xl border bg-panel p-5", pro ? "border-edge" : "border-live/40")}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Free · BYOK</h3>
            {!pro ? (
              <Badge tone="live" dot>
                Current
              </Badge>
            ) : null}
          </div>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-3xl font-semibold tracking-tight text-fg">€0</span>
            <span className="text-sm text-fg-3">/forever</span>
          </p>
          <PlanFeatures features={FREE_FEATURES} />
          <div className="mt-5 rounded-lg border border-edge bg-app-2 px-3 py-2.5">
            <p className="flex items-baseline justify-between gap-2 text-xs text-fg-2">
              <span>Imported repos in this browser</span>
              <span className="font-mono text-fg">{hydrated ? `${quota.used}${pro ? "" : ` / ${quota.limit}`}` : "…"}</span>
            </p>
            {!pro ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge" aria-hidden>
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (quota.used / FREE_REPO_LIMIT) * 100)}%` }} />
              </div>
            ) : null}
          </div>
        </li>
        <li className="relative flex flex-col rounded-xl border border-brand/60 bg-panel bg-gradient-to-b from-brand/10 to-panel p-5 shadow-[0_0_0_1px] shadow-brand/30">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Pro</h3>
            {pro ? (
              <Badge tone="live" dot>
                Active
              </Badge>
            ) : (
              <Badge tone="brand">Recommended</Badge>
            )}
          </div>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-3xl font-semibold tracking-tight text-fg">{PRO_PRICE}</span>
            <span className="text-sm text-fg-3">{PRO_PERIOD}</span>
          </p>
          <PlanFeatures features={PRO_FEATURES} featured />
          {license ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-app-2 px-3 py-2.5">
              <p className="min-w-0 truncate text-xs text-fg-2" title={license.sub}>
                {license.kind === "stripe" ? "Stripe checkout" : license.sub} · since {new Date(license.activatedAt).toLocaleDateString()}
              </p>
              <button type="button" onClick={() => useBilling.getState().deactivate()} className={cn(BTN_SECONDARY, "h-8")}>
                Remove from this browser
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <BuyProButton className="w-full" />
              <LicenseForm />
            </div>
          )}
        </li>
      </ul>
    </section>
  );
}

function PlanFeatures({ features, featured = false }: { features: readonly string[]; featured?: boolean }) {
  return (
    <ul className="mt-5 flex flex-1 flex-col gap-2 border-t border-edge pt-5">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-2 text-sm text-fg-2">
          <Check className={cn("mt-0.5 size-4 shrink-0", featured ? "text-brand-soft" : "text-live")} aria-hidden />
          {feature}
        </li>
      ))}
    </ul>
  );
}

/**
 * Entorno local en un grid simétrico de 2 columnas: editor/IDE, sincronización, puertos y ejecutor Docker.
 * Los servicios locales detectados (antes un popover del lienzo) ocupan la fila completa final.
 */
function EnvironmentSection() {
  return (
    <section aria-labelledby="env-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="env-title" className="text-sm font-semibold text-fg">
          Entorno local
        </h2>
        <p className="text-xs text-fg-3">Extensión de VS Code (y compatibles), puertos locales y ejecutor Docker.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <IdeCard />
        <SyncCard />
        <PortsCard />
        <DockerCard />
        <Panel aria-labelledby="services-title" className="flex flex-col lg:col-span-2">
          <PanelHeader id="services-title" icon={Radar} title="Servicios locales" description="Ollama, Postgres, Redis, Kafka y contenedores Docker en marcha." />
          <div className="p-5">
            <LocalServicesPanel />
          </div>
        </Panel>
      </div>
    </section>
  );
}

const SETTINGS_CARD = "flex h-full flex-col";

function IdeCard() {
  const { setup, save, setOpen } = useIdeSetup();
  const status = useTeacherStatus();
  const activeIde = setup?.ide ?? "vscode";

  function selectIde(ide: IdeId): void {
    if (setup) save({ ...setup, ide });
    else setOpen(true);
  }

  return (
    <Panel aria-labelledby="ide-title" className={SETTINGS_CARD}>
      <PanelHeader
        id="ide-title"
        icon={FolderGit2}
        title="Entorno e IDE"
        description="Editor activo y raíz del proyecto."
        actions={
          <Badge tone={STATUS[status].tone} dot>
            {STATUS[status].label}
          </Badge>
        }
      />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IDE_OPTIONS.map((option) => {
            const selected = activeIde === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectIde(option.id)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                  selected ? "border-brand/60 bg-brand/10 text-fg" : "border-edge text-fg-2 hover:bg-panel-2",
                )}
              >
                <span className="grid h-6 min-w-6 place-items-center rounded bg-app-2 px-1 font-mono text-[10px] font-semibold text-fg">{option.mark}</span>
                <span className="min-w-0 truncate">{option.label.replace(/ \(.*\)$/, "")}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-app-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-3">Raíz del proyecto</p>
            <p className="mt-0.5 truncate font-mono text-xs text-fg" title={setup?.projectRoot}>
              {setup ? shortenPath(setup.projectRoot) : "Sin configurar"}
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className={cn(setup ? BTN_SECONDARY : BTN_PRIMARY, "h-8")}>
            {setup ? "Cambiar" : "Configurar"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function SyncCard() {
  const focusEditor = useCanvasStore((state) => state.focusEditor);
  const followIde = useCanvasStore((state) => state.followIde);
  return (
    <Panel aria-labelledby="sync-title" className={SETTINGS_CARD}>
      <PanelHeader id="sync-title" icon={RefreshCw} title="Sincronización lienzo ↔ IDE" description="Cómo se siguen el lienzo y tu editor." />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Switch
          label="Enfocar IDE al navegar"
          description="Abre el archivo y la línea en tu editor al seleccionar un módulo en el lienzo."
          checked={focusEditor}
          onToggle={() => useCanvasStore.getState().toggleFocusEditor()}
        />
        <Switch
          label="Seguir el cursor del IDE"
          description="Resalta el nodo del archivo que estás editando."
          checked={followIde}
          onToggle={() => useCanvasStore.getState().toggleFollowIde()}
        />
      </div>
    </Panel>
  );
}

const noopSubscribe = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";

function PortsCard() {
  const localBaseUrl = useAiSettings((state) => state.localBaseUrl);
  const origin = useSyncExternalStore(noopSubscribe, readOrigin, serverOrigin);
  const ports = [
    { icon: MonitorSmartphone, label: "App web", value: origin || "http://localhost:3000" },
    { icon: Network, label: "Puente del IDE (WebSocket)", value: WS_URL },
    { icon: Cpu, label: "LLM local (Ollama / vLLM)", value: localBaseUrl || OLLAMA_DEFAULT_URL },
  ];
  return (
    <Panel aria-labelledby="ports-title" className={SETTINGS_CARD}>
      <PanelHeader id="ports-title" icon={Network} title="Puertos locales" description="Dónde escucha cada pieza del entorno." />
      <ul className="flex flex-1 flex-col divide-y divide-edge">
        {ports.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center justify-between gap-3 px-5 py-3">
            <span className="flex min-w-0 items-center gap-2 text-sm text-fg-2">
              <Icon className="size-4 shrink-0 text-fg-3" aria-hidden />
              <span className="truncate">{label}</span>
            </span>
            <span className="truncate font-mono text-xs text-fg" title={value}>
              {value}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DockerCard() {
  return (
    <Panel aria-labelledby="docker-title" className={SETTINGS_CARD}>
      <PanelHeader id="docker-title" icon={Container} title="Ejecutor Docker" description="Autoalojado, sin volúmenes persistentes." actions={<Badge>Autoalojado</Badge>} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="text-xs text-fg-3">
          El contenedor no guarda código, chats ni claves. Ollama del host se alcanza en{" "}
          <span className="font-mono text-fg-2">host.docker.internal:11434</span>.
        </p>
        <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-edge bg-app-2 px-3 py-2 font-mono text-xs text-fg-2">
          <span className="text-fg-3">$ </span>cd web && docker compose up -d --build
        </pre>
        <dl className="mt-auto grid grid-cols-2 gap-4">
          <Metric label="Imagen" value="archtrace-web:local" />
          <Metric label="Puerto" value="3000 → 3000" />
        </dl>
      </div>
    </Panel>
  );
}
