import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsoluteRoot, shortenPath } from "./ideSetup";

test("shortenPath keeps the last segment", () => {
  assert.equal(shortenPath("C:\\Users\\me\\mi-repo"), "~/.../mi-repo");
  assert.equal(shortenPath("/home/me/mi-repo/"), "~/.../mi-repo");
});

test("isAbsoluteRoot accepts disk paths only", () => {
  assert.equal(isAbsoluteRoot("C:/Users/me/repo"), true);
  assert.equal(isAbsoluteRoot("D:\\repo"), true);
  assert.equal(isAbsoluteRoot("/home/me/repo"), true);
  assert.equal(isAbsoluteRoot("repo"), false);
  assert.equal(isAbsoluteRoot("  "), false);
});
