"use client";

import { create } from "zustand";
import type { AuditListItem, AuditorAiSelection, AuditorHealth, AuditorRefs, AuditorRepo, AuditRun, CreateAuditRequest, DiffSide, ReviewStatus } from "@core/audit";
import { aiSelection as vaultSelection, useAiSettings } from "@/lib/ai/settings";
import { auditorClient, type AuditorClient } from "@/lib/auditor/client";
import { reviewQueue, stepIndex, type ReviewFilter } from "./lib/review";

const REPO_KEY = "archtrace:audit-repo";

type Busy = "linking" | "auditing" | "loading" | null;

/** De dónde sale la clave del LLM: bóveda del navegador, entorno del auditor (`auditor/.env`) o ninguna. */
export type LlmSource = "vault" | "env" | "off";

interface AuditState {
  /** null = aún no se comprobó. */
  online: boolean | null;
  health: AuditorHealth | null;
  repos: AuditorRepo[];
  repoId: string | null;
  refs: AuditorRefs | null;
  audits: AuditListItem[];
  run: AuditRun | null;
  runRepoId: string | null;
  filter: ReviewFilter;
  selectedId: string | null;
  /** Contenido de archivos por `auditId:side:path` (null = no existe en ese lado). */
  files: Record<string, string | null>;
  busy: Busy;
  error: string | null;
  init(): Promise<void>;
  linkRepo(path: string): Promise<void>;
  unlinkRepo(repoId: string): Promise<void>;
  selectRepo(repoId: string): Promise<void>;
  startAudit(request: Omit<CreateAuditRequest, "ai">, llm: LlmSource): Promise<string | null>;
  openAudit(repoId: string, auditId: string): Promise<void>;
  setFilter(filter: ReviewFilter): void;
  select(findingId: string): void;
  move(delta: 1 | -1): void;
  setReview(status: ReviewStatus, note?: string): Promise<void>;
  loadFile(side: DiffSide, path: string): Promise<void>;
  clearError(): void;
}

export function fileKey(auditId: string, side: DiffSide, path: string): string {
  return `${auditId}:${side}:${path}`;
}

/**
 * Selección BYOK del navegador. Espera a que la bóveda descifre las claves: sin `hydrate()` las claves cifradas
 * no están en memoria y la petición saldría sin clave.
 */
export async function aiSelection(): Promise<AuditorAiSelection | null> {
  await useAiSettings.getState().hydrate();
  const selection = vaultSelection();
  if (!selection?.provider) return null;
  return {
    provider: selection.provider,
    ...(selection.model ? { model: selection.model } : {}),
    ...(selection.apiKey ? { apiKey: selection.apiKey } : {}),
    ...(selection.baseUrl ? { baseUrl: selection.baseUrl } : {}),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Error inesperado del auditor.";
}

function rememberRepo(repoId: string): void {
  try {
    window.localStorage.setItem(REPO_KEY, repoId);
  } catch {
    // Sin localStorage: solo se pierde la preferencia.
  }
}

function rememberedRepo(): string | null {
  try {
    return window.localStorage.getItem(REPO_KEY);
  } catch {
    return null;
  }
}

export function createAuditStore(client: AuditorClient) {
  return create<AuditState>((set, get) => ({
    online: null,
    health: null,
    repos: [],
    repoId: null,
    refs: null,
    audits: [],
    run: null,
    runRepoId: null,
    filter: "all",
    selectedId: null,
    files: {},
    busy: null,
    error: null,

    async init() {
      const health = await client.health();
      const online = health !== null;
      set({ online, health });
      if (!online) return;
      try {
        const repos = await client.listRepos();
        set({ repos });
        const remembered = rememberedRepo();
        const usable = repos.filter((repo) => repo.available !== false);
        const initial = usable.find((repo) => repo.id === remembered)?.id ?? usable[0]?.id ?? repos[0]?.id;
        if (initial && !get().repoId) await get().selectRepo(initial);
      } catch (error) {
        set({ error: message(error) });
      }
    },

    async linkRepo(path) {
      set({ busy: "linking", error: null });
      try {
        const { repo } = await client.linkRepo(path);
        set((state) => ({ repos: [...state.repos.filter((item) => item.id !== repo.id), repo] }));
        await get().selectRepo(repo.id);
      } catch (error) {
        set({ error: message(error) });
      } finally {
        set({ busy: null });
      }
    },

    async unlinkRepo(repoId) {
      try {
        await client.unlinkRepo(repoId);
        const repos = get().repos.filter((repo) => repo.id !== repoId);
        set({ repos, repoId: null, refs: null, audits: [] });
        const next = repos.find((repo) => repo.available !== false) ?? repos[0];
        if (next) await get().selectRepo(next.id);
      } catch (error) {
        set({ error: message(error) });
      }
    },

    async selectRepo(repoId) {
      rememberRepo(repoId);
      set({ repoId, refs: null, audits: [], error: null });
      try {
        const [refs, audits] = await Promise.all([client.refs(repoId), client.listAudits(repoId)]);
        if (get().repoId === repoId) set({ refs, audits });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    async startAudit(request, llm) {
      const repoId = get().repoId;
      if (!repoId) return null;
      let ai: CreateAuditRequest["ai"] = null;
      if (llm === "vault") {
        ai = await aiSelection();
        if (!ai) {
          set({ error: "Elige un proveedor de IA en API & Integración o desactiva el análisis semántico." });
          return null;
        }
      } else if (llm === "env") {
        ai = "env";
      }
      set({ busy: "auditing", error: null });
      try {
        const run = await client.createAudit(repoId, { ...request, ai });
        const audits = await client.listAudits(repoId);
        set({ run, runRepoId: repoId, audits, selectedId: reviewQueue(run.findings)[0]?.id ?? null, files: {} });
        return run.id;
      } catch (error) {
        set({ error: message(error) });
        return null;
      } finally {
        set({ busy: null });
      }
    },

    async openAudit(repoId, auditId) {
      const current = get().run;
      if (current?.id === auditId && get().runRepoId === repoId) return;
      set({ busy: "loading", error: null });
      try {
        const run = await client.getAudit(repoId, auditId);
        set({ run, runRepoId: repoId, selectedId: reviewQueue(run.findings, get().filter)[0]?.id ?? reviewQueue(run.findings)[0]?.id ?? null, files: {} });
      } catch (error) {
        set({ error: message(error) });
      } finally {
        set({ busy: null });
      }
    },

    setFilter(filter) {
      const run = get().run;
      const queue = run ? reviewQueue(run.findings, filter) : [];
      const selected = get().selectedId;
      set({ filter, selectedId: queue.some((finding) => finding.id === selected) ? selected : (queue[0]?.id ?? null) });
    },

    select(findingId) {
      set({ selectedId: findingId });
    },

    move(delta) {
      const { run, filter, selectedId } = get();
      if (!run) return;
      const queue = reviewQueue(run.findings, filter);
      const index = queue.findIndex((finding) => finding.id === selectedId);
      const next = queue[stepIndex(index < 0 ? 0 : index, index < 0 ? 0 : delta, queue.length)];
      if (next) set({ selectedId: next.id });
    },

    async setReview(status, note) {
      const { run, runRepoId, selectedId } = get();
      if (!run || !runRepoId || !selectedId) return;
      const previous = run.findings.find((finding) => finding.id === selectedId);
      if (!previous) return;
      const optimistic = { status, ...(note !== undefined ? { note } : previous.review.note ? { note: previous.review.note } : {}), updatedAt: new Date().toISOString() };
      const patch = (review: typeof previous.review) =>
        set((state) =>
          state.run && state.run.id === run.id
            ? { run: { ...state.run, findings: state.run.findings.map((finding) => (finding.id === selectedId ? { ...finding, review } : finding)) } }
            : {},
        );
      patch(optimistic);
      try {
        const saved = await client.reviewFinding(runRepoId, run.id, selectedId, { status, ...(optimistic.note !== undefined ? { note: optimistic.note } : {}) });
        patch(saved.review);
        set((state) => ({
          audits: state.audits.map((item) =>
            item.id === run.id ? { ...item, reviewed: (get().run?.findings ?? []).filter((finding) => finding.review.status !== "pending").length } : item,
          ),
        }));
      } catch (error) {
        patch(previous.review);
        set({ error: message(error) });
      }
    },

    async loadFile(side, path) {
      const { run, runRepoId, files } = get();
      if (!run || !runRepoId) return;
      const key = fileKey(run.id, side, path);
      if (key in files) return;
      try {
        const version = await client.fileVersion(runRepoId, run.id, side, path);
        set((state) => ({ files: { ...state.files, [key]: version.content } }));
      } catch (error) {
        set((state) => ({ files: { ...state.files, [key]: null }, error: message(error) }));
      }
    },

    clearError() {
      set({ error: null });
    },
  }));
}

export const useAuditStore = createAuditStore(auditorClient);
