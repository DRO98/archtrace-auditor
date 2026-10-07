"use client";

import { useState, type FormEvent } from "react";
import { Check, KeyRound, Loader2, Sparkles } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD } from "@/features/dashboard/ui";
import { cn } from "@/lib/cn";
import { PRO_CHECKOUT_URL, PRO_FEATURES, PRO_PERIOD, PRO_PRICE } from "./plans";
import { FREE_REPO_LIMIT } from "./quota";
import { useBilling } from "./store";

/** Campo para pegar una licencia (clave `ATP1.…` o id de sesión de Stripe) y validarla en `/api/license`. */
export function LicenseForm({ onActivated, className }: { onActivated?: () => void; className?: string }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await useBilling.getState().activate(key);
    setBusy(false);
    if (result.ok) {
      setKey("");
      onActivated?.();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className={cn("flex flex-col gap-2", className)}>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
        <span className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" aria-hidden />
          Already have a license?
        </span>
        <span className="flex gap-2">
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="ATP1.… or cs_live_…"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            className={cn(FIELD, "min-w-0 flex-1 font-mono text-xs")}
          />
          <button type="submit" disabled={busy || key.trim() === ""} className={BTN_SECONDARY}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Activate
          </button>
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Botón de compra: el Payment Link si está configurado; si no, deshabilitado (nunca un enlace roto). */
export function BuyProButton({ className }: { className?: string }) {
  if (!PRO_CHECKOUT_URL) {
    return (
      <button type="button" disabled className={cn(BTN_PRIMARY, className)} title="NEXT_PUBLIC_PRO_CHECKOUT_URL is not set">
        Pro checkout coming soon
      </button>
    );
  }
  return (
    <a href={PRO_CHECKOUT_URL} className={cn(BTN_PRIMARY, className)}>
      <Sparkles className="size-4" aria-hidden />
      Get Pro · {PRO_PRICE}
      {PRO_PERIOD}
    </a>
  );
}

/** Se muestra al intentar el tercer import sin licencia. Copy en inglés: es superficie de GTM. */
export function Paywall({ onActivated, onCancel }: { onActivated: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold text-fg">You&apos;ve used your {FREE_REPO_LIMIT} free projects</h3>
        <p className="mt-1 text-sm text-fg-2">
          Upgrade to Pro to map as many repos as you want. Your imported projects stay available, and demos are always free.
        </p>
      </div>
      <ul className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand/5 p-4">
        {PRO_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-fg-2">
            <Check className="mt-0.5 size-4 shrink-0 text-brand-soft" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          Not now
        </button>
        <BuyProButton />
      </div>
      <LicenseForm onActivated={onActivated} className="border-t border-edge pt-4" />
    </div>
  );
}
