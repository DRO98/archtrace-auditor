import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { WORKTREE_REF } from "@core/audit";
import { createTestRepo, type TestRepo } from "../test/gitRepo";
import { collectChanges, GitError, readVersion, resolveCommit } from "./changes";

describe("collectChanges", () => {
  let repo: TestRepo;
  let first = "";
  let second = "";

  before(async () => {
    repo = await createTestRepo();
    repo.write("app.py", "def a():\n    return 1\n");
    first = await repo.commit("inicial");
    await repo.git("checkout", "-q", "-b", "feature");
    repo.write("app.py", "def a():\n    return 2\n");
    repo.write("lib/util.py", "X = 1\n");
    second = await repo.commit("cambio");
  });

  after(() => repo.dispose());

  it("commit: HEAD frente a su padre", async () => {
    const changes = await collectChanges(repo.root, { mode: "commit" });
    assert.equal(changes.baseSha, first);
    assert.equal(changes.headSha, second);
    assert.deepEqual(changes.patches.map((patch) => [patch.path, patch.status]), [
      ["app.py", "modified"],
      ["lib/util.py", "added"],
    ]);
    const lines = changes.patches[0]!.hunks.flatMap((hunk) => hunk.lines);
    assert.deepEqual(lines, [
      { kind: "del", line: 2, text: "    return 1" },
      { kind: "add", line: 2, text: "    return 2" },
    ]);
  });

  it("commit raíz: la base es el árbol vacío", async () => {
    const changes = await collectChanges(repo.root, { mode: "commit", head: first });
    assert.deepEqual(changes.patches.map((patch) => patch.status), ["added"]);
  });

  it("range y branch", async () => {
    const range = await collectChanges(repo.root, { mode: "range", base: first, head: second });
    assert.equal(range.patches.length, 2);
    const branch = await collectChanges(repo.root, { mode: "branch", base: "main" });
    assert.equal(branch.baseSha, first);
    assert.equal(branch.patches.length, 2);
  });

  it("worktree: cambios sin commitear + sin seguimiento, sin artefactos del auditor", async () => {
    repo.write("app.py", "def a():\n    return 3\n");
    repo.write("nuevo.py", "def b():\n    pass\n");
    repo.write("Auditoria.md", "# x\n");
    repo.write(".archtrace/audits/x.json", "{}\n");
    const changes = await collectChanges(repo.root, { mode: "worktree" });
    assert.equal(changes.headSha, WORKTREE_REF);
    assert.deepEqual(changes.patches.map((patch) => [patch.path, patch.status, Boolean(patch.untracked)]), [
      ["app.py", "modified", false],
      ["nuevo.py", "added", true],
    ]);
    assert.equal(changes.patches[1]!.hunks[0]!.lines.length, 2);
    assert.match(changes.patches[1]!.newBlob ?? "", /^[0-9a-f]{40}$/);
    assert.equal(await readVersion(repo.root, WORKTREE_REF, "app.py", undefined), "def a():\n    return 3\n");
    assert.equal(await readVersion(repo.root, changes.baseSha, "app.py", changes.patches[0]!.oldBlob), "def a():\n    return 2\n");
    assert.equal(await readVersion(repo.root, WORKTREE_REF, "../fuera.txt", undefined), null);
    await repo.git("checkout", "-q", "--", "app.py");
    repo.remove("nuevo.py");
    repo.remove("Auditoria.md");
  });

  it("rechaza refs inseguros", async () => {
    await assert.rejects(resolveCommit(repo.root, "--output=/tmp/x"), GitError);
    await assert.rejects(resolveCommit(repo.root, "main..feature"), GitError);
    await assert.rejects(collectChanges(repo.root, { mode: "range", base: "-p", head: "HEAD" }), GitError);
  });
});
