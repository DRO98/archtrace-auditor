"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  isIdeSetupModalOpen,
  readIdeSetup,
  setIdeSetupModalOpen,
  subscribeIdeSetup,
  subscribeIdeSetupModal,
  writeIdeSetup,
  type IdeSetup,
} from "./ideSetup";

let cachedKey: string | null = null;
let cachedSetup: IdeSetup | null = null;

/** `readIdeSetup` crea un objeto nuevo en cada lectura: se cachea para que el snapshot sea estable. */
function getSetupSnapshot(): IdeSetup | null {
  const next = readIdeSetup();
  const key = next ? `${next.ide}|${next.projectRoot}` : "";
  if (key !== cachedKey) {
    cachedKey = key;
    cachedSetup = next;
  }
  return cachedSetup;
}

const noopSubscribe = () => () => {};
const getNull = () => null;
const getFalse = () => false;
const getTrue = () => true;

export function useIdeSetup(): {
  setup: IdeSetup | null;
  hydrated: boolean;
  open: boolean;
  save: (setup: IdeSetup) => void;
  setOpen: (open: boolean) => void;
} {
  const setup = useSyncExternalStore(subscribeIdeSetup, getSetupSnapshot, getNull);
  const open = useSyncExternalStore(subscribeIdeSetupModal, isIdeSetupModalOpen, getFalse);
  // false en el servidor y en la hidratación, true después: `localStorage` ya es legible.
  const hydrated = useSyncExternalStore(noopSubscribe, getTrue, getFalse);

  const save = useCallback((next: IdeSetup) => {
    writeIdeSetup(next);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setIdeSetupModalOpen(next);
  }, []);

  return { setup, hydrated, open, save, setOpen };
}
