"use client";

import { create } from "zustand";

/** Hallazgo del Architecture Check que prellena el brief de cambio de la pestaña Impacto. */
export interface BriefSeed {
  moduleId: string;
  findingId: string;
  title: string;
  fixHint: string;
}

interface BriefSeedState {
  seed: BriefSeed | null;
  setSeed: (seed: BriefSeed | null) => void;
}

export const useBriefSeed = create<BriefSeedState>((set) => ({
  seed: null,
  setSeed: (seed) => set({ seed }),
}));
