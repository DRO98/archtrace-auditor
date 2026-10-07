import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { archtraceHome, repoKey } from "../paths";

export interface RegisteredRepo {
  id: string;
  root: string;
  name: string;
  addedAt: string;
}

/** Repos vinculados desde la UI (`~/.archtrace/repos.json`). Solo rutas: nada de credenciales. */
export class RepoRegistry {
  private readonly file: string;
  private repos: RegisteredRepo[] = [];

  constructor(home = archtraceHome()) {
    this.file = path.join(home, "repos.json");
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
        if (Array.isArray(parsed)) this.repos = parsed.filter(isRepo);
      } catch {
        this.repos = [];
      }
    }
  }

  /** Con `available: false` los que ya no existen en disco (movidos o borrados). */
  list(): Array<RegisteredRepo & { available: boolean }> {
    return this.repos.map((repo) => ({ ...repo, available: existsSync(path.join(repo.root, ".git")) || existsSync(repo.root) }));
  }

  remove(id: string): boolean {
    const before = this.repos.length;
    this.repos = this.repos.filter((repo) => repo.id !== id);
    if (this.repos.length === before) return false;
    this.save();
    return true;
  }

  get(id: string): RegisteredRepo | null {
    return this.repos.find((repo) => repo.id === id) ?? null;
  }

  add(root: string): RegisteredRepo {
    const id = repoKey(root);
    const existing = this.get(id);
    if (existing) return existing;
    const repo: RegisteredRepo = { id, root, name: path.basename(root), addedAt: new Date().toISOString() };
    this.repos.push(repo);
    this.save();
    return repo;
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.repos, null, 2), "utf8");
    renameSync(temporary, this.file);
  }
}

function isRepo(value: unknown): value is RegisteredRepo {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.root === "string" && typeof record.name === "string";
}
