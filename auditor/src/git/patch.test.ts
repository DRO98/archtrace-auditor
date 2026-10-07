import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnifiedDiff, unquote } from "./patch";

const SAMPLE = [
  "diff --git a/players/views.py b/players/views.py",
  "index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644",
  "--- a/players/views.py",
  "+++ b/players/views.py",
  "@@ -3,0 +4,2 @@ def delete(request, pk):",
  "+    if not request.user.has_perm('players.delete_player'):",
  "+        return HttpResponseForbidden()",
  "@@ -10 +12 @@ def other():",
  "-    return 1",
  "+    return 2",
  "diff --git a/old name.py b/new name.py",
  "similarity index 90%",
  "rename from old name.py",
  "rename to new name.py",
  "index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644",
  "--- a/old name.py\t",
  "+++ b/new name.py\t",
  "@@ -1 +1 @@",
  "-a = 1",
  "\\ No newline at end of file",
  "+a = 2",
  "diff --git a/new.txt b/new.txt",
  "new file mode 100644",
  "index 0000000000000000000000000000000000000000..5555555555555555555555555555555555555555",
  "--- /dev/null",
  "+++ b/new.txt",
  "@@ -0,0 +1 @@",
  "+hola",
  "diff --git a/gone.py b/gone.py",
  "deleted file mode 100644",
  "index 6666666666666666666666666666666666666666..0000000000000000000000000000000000000000",
  "--- a/gone.py",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-x = 1",
  "diff --git a/logo.png b/logo.png",
  "index 7777777777777777777777777777777777777777..8888888888888888888888888888888888888888 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  const patches = parseUnifiedDiff(SAMPLE);

  it("lee hunks con números de línea de cada lado", () => {
    const views = patches[0]!;
    assert.equal(views.path, "players/views.py");
    assert.equal(views.status, "modified");
    assert.equal(views.oldBlob, "1111111111111111111111111111111111111111");
    assert.equal(views.hunks.length, 2);
    assert.deepEqual(views.hunks[0]!.lines.map((line) => [line.kind, line.line]), [
      ["add", 4],
      ["add", 5],
    ]);
    assert.deepEqual(views.hunks[1]!.lines, [
      { kind: "del", line: 10, text: "    return 1" },
      { kind: "add", line: 12, text: "    return 2" },
    ]);
  });

  it("detecta renombrados con espacios, altas, bajas y binarios", () => {
    assert.deepEqual(
      patches.map((patch) => [patch.path, patch.status, patch.previousPath ?? null, patch.binary]),
      [
        ["players/views.py", "modified", null, false],
        ["new name.py", "renamed", "old name.py", false],
        ["new.txt", "added", null, false],
        ["gone.py", "deleted", null, false],
        ["logo.png", "modified", null, true],
      ],
    );
    assert.deepEqual(patches[1]!.hunks[0]!.lines, [
      { kind: "del", line: 1, text: "a = 1" },
      { kind: "add", line: 1, text: "a = 2" },
    ]);
    assert.equal(patches[2]!.oldBlob, undefined);
    assert.equal(patches[3]!.newBlob, undefined);
    assert.deepEqual(patches[3]!.hunks[0]!.lines, [{ kind: "del", line: 1, text: "x = 1" }]);
  });

  it("decodifica rutas entrecomilladas al estilo C", () => {
    assert.equal(unquote('"caf\\303\\251.py"'), "café.py");
    const quoted = parseUnifiedDiff(
      ['diff --git "a/caf\\303\\251.py" "b/caf\\303\\251.py"', '--- "a/caf\\303\\251.py"', '+++ "b/caf\\303\\251.py"', "@@ -1 +1 @@", "-a", "+b"].join("\n"),
    );
    assert.equal(quoted[0]!.path, "café.py");
  });
});
