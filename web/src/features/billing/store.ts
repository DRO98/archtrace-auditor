"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { hydrateMemoryGraphs, listMemorySources } from "@/features/canvas/lib/memoryGraphs";
import { QUOTA_KEY, parseImported, withImported } from "./quota";

/** Licencia Pro ya validada por `/api/license`. Vive en `localStorage` de este navegador. */
export const LICENSE_KEY = "archtrace.proLicense";

export interface StoredLicense {
  key: string;
  kind: "signed" | "stripe";
  sub: string;
  activatedAt: number;
}

interface BillingState {
  hydrated: boolean;
  license: StoredLicense | null;
  /** Grafos que han gastado cuota Free en este navegador. */
  imported: string[];
  hydrate: () => Promise<void>;
  recordImport: (name: string) => void;
  activate: (key: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  deactivate: () => void;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Sin localStorage: la cuota y la licencia duran lo que la pestaña.
  }
}

function parseLicense(raw: string | null): StoredLicense | null {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<StoredLicense> | null;
    return value && typeof value.key === "string" && (value.kind === "signed" || value.kind === "stripe") ? (value as StoredLicense) : null;
  } catch {
    return null;
  }
}

let hydration: Promise<void> | null = null;

export const useBilling = create<BillingState>((set, get) => ({
  hydrated: false,
  license: null,
  imported: [],
  hydrate: () => {
    hydration ??= (async () => {
      const license = parseLicense(read(LICENSE_KEY));
      let imported = parseImported(read(QUOTA_KEY));
      if (imported === null) {
        // Primera vez con cuota: cuentan los grafos que este navegador ya tenía guardados (no se les bloquea abrirlos).
        await hydrateMemoryGraphs();
        imported = listMemorySources().map((source) => source.name);
        write(QUOTA_KEY, JSON.stringify(imported));
      }
      set({ hydrated: true, license, imported });
    })();
    return hydration;
  },
  recordImport: (name) => {
    const imported = withImported(get().imported, name);
    write(QUOTA_KEY, JSON.stringify(imported));
    set({ imported });
  },
  activate: async (key) => {
    try {
      const response = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = (await response.json()) as { ok?: boolean; kind?: StoredLicense["kind"]; sub?: string; error?: string };
      if (!response.ok || !body.ok || !body.kind) return { ok: false, error: body.error ?? "This license is not valid." };
      const license: StoredLicense = { key: key.trim(), kind: body.kind, sub: body.sub ?? "", activatedAt: Date.now() };
      write(LICENSE_KEY, JSON.stringify(license));
      set({ license });
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not verify the license. Check your connection and try again." };
    }
  },
  deactivate: () => {
    write(LICENSE_KEY, null);
    set({ license: null });
  },
}));

export function useIsPro(): boolean {
  return useBilling((state) => state.license !== null);
}

/** Lee cuota y licencia de este navegador una vez montado (en el servidor todo es Free). */
export function useBillingHydration(): boolean {
  const hydrated = useBilling((state) => state.hydrated);
  useEffect(() => {
    void useBilling.getState().hydrate();
  }, []);
  return hydrated;
}
