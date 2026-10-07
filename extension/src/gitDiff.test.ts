import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { gitDiff, gitRefs, isSafeRef, parseNameStatus, workspaceMapper, type GitRunner } from "./gitDiff.js";

const ROOT = path.resolve("/repo");
const WORKSPACE = path.join(ROOT, "apps", "shop");

test("isSafeRef acepta ramas, tags y SHAs y rechaza opciones y rangos", () => {
  for (const ok of ["main", "origin/main", "v1.2.0", "HEAD~3", "a1b2c3d", "feature/kafka-outbox"]) assert.equal(isSafeRef(ok), true, ok);
  for (const bad of ["--output=/tmp/x", "-p", "main..dev", "HEAD@{1}", "a b", "", "x;rm"]) assert.equal(isSafeRef(bad), false, bad);
});

test("parseNameStatus con -z: añadidos, modificados, borrados y renombrados; fuera del workspace se descarta", () => {
  const stdout = ["A", "apps/shop/src/new.ts", "M", "apps/shop/src/api.ts", "D", "apps/shop/src/old.py", "R087", "apps/shop/src/a.ts", "apps/shop/src/b.ts", "M", "libs/other.ts", ""].join("\0");
  const changes = parseNameStatus(stdout, workspaceMapper(ROOT, WORKSPACE));
  assert.deepEqual(changes, [
    { path: "src/new.ts", status: "added" },
    { path: "src/api.ts", status: "modified" },
    { path: "src/old.py", status: "deleted" },
    { path: "src/b.ts", status: "renamed", previousPath: "src/a.ts" },
  ]);
});

test("gitDiff pasa los refs como argumentos, con -- al final, y nunca llama a git con refs inválidos", async () => {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    if (args[0] === "rev-parse") return `${ROOT}\n`;
    return ["M", "apps/shop/src/api.ts", ""].join("\0");
  };
  const result = await gitDiff(WORKSPACE, "main", null, git);
  assert.deepEqual(result.files, [{ path: "src/api.ts", status: "modified" }]);
  assert.deepEqual(calls[1], ["diff", "--name-status", "-M", "-z", "main", "--"]);

  calls.length = 0;
  const rejected = await gitDiff(WORKSPACE, "--output=/tmp/pwn", "main", git);
  assert.equal(rejected.error, "Ref no válido.");
  assert.equal(calls.length, 0);
});

test("gitRefs: rama actual, ramas y commits; error legible si no es un repo", async () => {
  const git: GitRunner = async (args) => {
    if (args[0] === "rev-parse") return "main\n";
    if (args[0] === "for-each-ref") return "main\norigin/HEAD\norigin/main\nfeature/x\n";
    return `${"a".repeat(40)}\x1fAñade outbox\x1f2026-09-27T10:00:00+02:00\n`;
  };
  const refs = await gitRefs(WORKSPACE, git);
  assert.equal(refs.current, "main");
  assert.deepEqual(refs.branches, ["main", "origin/main", "feature/x"]);
  assert.equal(refs.commits[0]?.subject, "Añade outbox");

  const broken = await gitRefs(WORKSPACE, async () => {
    throw new Error("fatal: not a git repository");
  });
  assert.match(broken.error ?? "", /not a git repository/);
});
