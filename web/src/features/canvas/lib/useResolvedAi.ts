"use client";

import { useEffect, useState } from "react";
import { isProviderId, selectionLabel } from "@/lib/ai/catalog";
import { aiSelection, useAiSettings } from "@/lib/ai/settings";

export type ResolvedAi =
  | { status: "loading" }
  | { status: "error" }
  | { status: "none" }
  | { status: "ok"; provider: string; model: string; label: string };

/**
 * Pregunta al servidor qué proveedor y modelo usará con la selección guardada
 * (o el `.env` si la selección no trae clave). Se recalcula al guardar ajustes.
 */
export function useResolvedAi(): ResolvedAi {
  const hydrated = useAiSettings((state) => state.hydrated);
  const provider = useAiSettings((state) => state.provider);
  const models = useAiSettings((state) => state.models);
  const keys = useAiSettings((state) => state.keys);
  const [resolved, setResolved] = useState<ResolvedAi>({ status: "loading" });

  useEffect(() => {
    if (!hydrated) void useAiSettings.getState().hydrate();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    void fetch("/api/ai/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai: aiSelection() }),
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: unknown) => {
        if (typeof body !== "object" || body === null || !("configured" in body) || body.configured !== true) {
          setResolved({ status: "none" });
          return;
        }
        const id = "provider" in body ? body.provider : null;
        const model = "model" in body && typeof body.model === "string" ? body.model : "";
        const label = isProviderId(id) ? selectionLabel(id, model) : `${String(id)} · ${model}`;
        setResolved({ status: "ok", provider: String(id), model, label });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved({ status: "error" });
      });
    return () => controller.abort();
  }, [hydrated, provider, models, keys]);

  return resolved;
}
