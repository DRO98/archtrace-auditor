import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "../git/run";

/** Repo git desechable en el directorio temporal, para tests de integración. */
export interface TestRepo {
  root: string;
  git(...args: string[]): Promise<string>;
  write(file: string, content: string): void;
  remove(file: string): void;
  commit(message: string): Promise<string>;
  dispose(): void;
}

export async function createTestRepo(prefix = "archtrace-audit-"): Promise<TestRepo> {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (...args: string[]) => runGit(args, root);
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.com");
  await git("config", "core.autocrlf", "false");
  await git("config", "commit.gpgsign", "false");
  return {
    root,
    git,
    write(file, content) {
      const absolute = path.join(root, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, "utf8");
    },
    remove(file) {
      unlinkSync(path.join(root, file));
    },
    async commit(message) {
      await git("add", "-A");
      await git("commit", "-q", "-m", message);
      return (await git("rev-parse", "HEAD")).trim();
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
