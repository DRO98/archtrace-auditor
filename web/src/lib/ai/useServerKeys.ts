"use client";

import { useEffect, useState } from "react";
import { isProviderId, type AiProviderId } from "./catalog";

export type ServerKeys = Partial<Record<AiProviderId, boolean>>;

let pending: Promise<ServerKeys> | null = null;

/** Una sola petición por carga de página: las claves del `.env` no cambian sin reiniciar el servidor. */
function loadServerKeys(): Promise<ServerKeys> {
  pending ??= fetch("/api/ai/status")
    .then((response) => response.json())
    .then((body: unknown): ServerKeys => {
      const raw = typeof body === "object" && body !== null && "envKeys" in body ? body.envKeys : null;
      if (typeof raw !== "object" || raw === null) return {};
      const keys: ServerKeys = {};
      for (const [id, present] of Object.entries(raw)) if (isProviderId(id) && present === true) keys[id] = true;
      return keys;
    })
    .catch(() => {
      pending = null;
      return {};
    });
  return pending;
}

/** Qué proveedores tienen clave en el servidor (`.env` / `.env.local`). `null` mientras se consulta. */
export function useServerKeys(): ServerKeys | null {
  const [keys, setKeys] = useState<ServerKeys | null>(null);
  useEffect(() => {
    let alive = true;
    void loadServerKeys().then((next) => {
      if (alive) setKeys(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return keys;
}
