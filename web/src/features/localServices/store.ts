"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { LocalServicesDiscoveredPayload } from "@core/protocol";
import { requestLocalServices, subscribeLocalServices } from "@/hooks/useTeacherSocket";

/** Si la extensión no responde en este tiempo, el sondeo se da por perdido. */
const SCAN_TIMEOUT_MS = 8_000;

interface LocalServicesState {
  result: LocalServicesDiscoveredPayload | null;
  scanning: boolean;
  error: string | null;
  /** Pide un sondeo a la extensión (puertos conocidos de 127.0.0.1 + `docker ps`). */
  scan: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Servicios locales que anuncia la extensión (`LOCAL_SERVICES_DISCOVERED`). La lógica WS vive aquí y en
 * `useTeacherSocket`; los componentes solo leen el store.
 */
export const useLocalServices = create<LocalServicesState>((set) => ({
  result: null,
  scanning: false,
  error: null,
  scan: () => {
    if (!requestLocalServices()) {
      set({ scanning: false, error: "El IDE no está conectado: abre el workspace en VS Code con la extensión ArchTrace." });
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => set({ scanning: false, error: "La extensión no respondió al sondeo." }), SCAN_TIMEOUT_MS);
    set({ scanning: true, error: null });
  },
}));

let subscribers = 0;
let unsubscribe: (() => void) | null = null;

/** Mantiene el store al día mientras haya algún componente montado que lo use. */
export function useLocalServicesSync(): void {
  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) {
      unsubscribe = subscribeLocalServices((result) => {
        clearTimeout(timer);
        useLocalServices.setState({ result, scanning: false, error: null });
      });
    }
    return () => {
      subscribers -= 1;
      if (subscribers === 0) {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
  }, []);
}
