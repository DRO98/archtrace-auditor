import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEditorDeepLink } from "./editorLink";

test("windows root with spaces", () => {
  assert.equal(
    buildEditorDeepLink("C:\\Users\\me\\My Repo\\", { filePath: "src/rag/embeddings.py", line: 12 }),
    "vscode://file/C:/Users/me/My%20Repo/src/rag/embeddings.py:12",
  );
});

test("posix root and cursor scheme", () => {
  assert.equal(
    buildEditorDeepLink("/home/me/repo", { filePath: "src/api/routes.py", line: 3 }, "cursor"),
    "cursor://file/home/me/repo/src/api/routes.py:3",
  );
});

test("missing root or escaping paths yield null", () => {
  assert.equal(buildEditorDeepLink(undefined, { filePath: "a.py", line: 1 }), null);
  assert.equal(buildEditorDeepLink("/r", { filePath: "../etc/passwd", line: 1 }), null);
  assert.equal(buildEditorDeepLink("/r", { filePath: "/etc/passwd", line: 1 }), null);
  assert.equal(buildEditorDeepLink("/r", { filePath: "C:/x.py", line: 1 }), null);
});

test("invalid line falls back to 1", () => {
  assert.equal(buildEditorDeepLink("/r", { filePath: "a.py", line: 0 }), "vscode://file/r/a.py:1");
});

test("windsurf uses the file scheme", () => {
  assert.equal(
    buildEditorDeepLink("C:/repo", { filePath: "src/a.ts", line: 4 }, "windsurf"),
    "windsurf://file/C:/repo/src/a.ts:4",
  );
});

test("jetbrains opens with idea protocol", () => {
  assert.equal(
    buildEditorDeepLink("/home/me/repo", { filePath: "src/a.py", line: 8 }, "jetbrains"),
    "idea://open?file=%2Fhome%2Fme%2Frepo%2Fsrc%2Fa.py&line=8",
  );
});
