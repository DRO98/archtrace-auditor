"use client";

import { useEffect } from "react";
import { useProviderStatus } from "@/lib/ai/providerStatus";
import { useAiSettings } from "@/lib/ai/settings";
import { useServerKeys } from "@/lib/ai/useServerKeys";

/**
 * Descifra el vault de claves al entrar al dashboard y verifica una vez por sesión los proveedores
 * configurados (clave del navegador o del `.env`, y el servidor local): así los selectores de modelo
 * del lienzo y de "Probar en vivo" solo ofrecen modelos de proveedores con clave válida.
 */
export function AiVaultBootstrap() {
  const hydrated = useAiSettings((state) => state.hydrated);
  const serverKeys = useServerKeys();

  useEffect(() => {
    if (!hydrated) void useAiSettings.getState().hydrate();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || serverKeys === null) return;
    void useProviderStatus.getState().verifyConfigured(serverKeys);
  }, [hydrated, serverKeys]);

  return null;
}
