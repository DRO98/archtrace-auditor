export const PROJECT_ROOT_KEY = "teacher_project_root";
export const IDE_KEY = "teacher_ide";

export type IdeId = "cursor" | "vscode" | "windsurf" | "jetbrains";

export interface IdeSetup {
  projectRoot: string;
  ide: IdeId;
}

export interface IdeOption {
  id: IdeId;
  label: string;
  mark: string;
}

export const IDE_OPTIONS: readonly IdeOption[] = [
  { id: "cursor", label: "Cursor", mark: "Cu" },
  { id: "vscode", label: "VS Code", mark: "VS" },
  { id: "windsurf", label: "Windsurf", mark: "W" },
  { id: "jetbrains", label: "JetBrains (PyCharm/IntelliJ)", mark: "JB" },
];

const IDE_IDS: ReadonlySet<string> = new Set(IDE_OPTIONS.map((option) => option.id));

type Listener = () => void;

const listeners = new Set<Listener>();
let modalOpen = false;
const modalListeners = new Set<Listener>();

export function isIdeId(value: string | null): value is IdeId {
  return value !== null && IDE_IDS.has(value);
}

export function ideOption(id: IdeId): IdeOption {
  const option = IDE_OPTIONS.find((item) => item.id === id);
  if (!option) return IDE_OPTIONS[1];
  return option;
}

/** Ruta absoluta de disco: `/…` o `C:\…` / `C:/…`. */
export function isAbsoluteRoot(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}

/** `C:/Users/me/mi-repo` y `/home/me/mi-repo` → `~/.../mi-repo`. */
export function shortenPath(path: string): string {
  const parts = path.trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return "~/...";
  return `~/.../${last}`;
}

function browserStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function readIdeSetup(): IdeSetup | null {
  const store = browserStorage();
  if (!store) return null;
  const projectRoot = store.getItem(PROJECT_ROOT_KEY)?.trim() ?? "";
  if (!isAbsoluteRoot(projectRoot)) return null;
  const ideRaw = store.getItem(IDE_KEY);
  return { projectRoot, ide: isIdeId(ideRaw) ? ideRaw : "vscode" };
}

export function writeIdeSetup(setup: IdeSetup): void {
  const store = browserStorage();
  if (!store) return;
  const projectRoot = setup.projectRoot.trim();
  if (!isAbsoluteRoot(projectRoot)) return;
  store.setItem(PROJECT_ROOT_KEY, projectRoot);
  store.setItem(IDE_KEY, setup.ide);
  for (const listener of listeners) listener();
}

export function subscribeIdeSetup(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isIdeSetupModalOpen(): boolean {
  return modalOpen;
}

export function setIdeSetupModalOpen(open: boolean): void {
  if (modalOpen === open) return;
  modalOpen = open;
  for (const listener of modalListeners) listener();
}

export function subscribeIdeSetupModal(listener: Listener): () => void {
  modalListeners.add(listener);
  return () => {
    modalListeners.delete(listener);
  };
}
