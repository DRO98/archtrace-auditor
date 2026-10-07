import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalBaseUrl } from "./env";

test("resolveLocalBaseUrl acepta hosts locales o privados y rechaza internet", () => {
  assert.equal(resolveLocalBaseUrl("http://localhost:8000/v1/"), "http://localhost:8000/v1");
  assert.equal(resolveLocalBaseUrl("http://192.168.1.20:11434/v1"), "http://192.168.1.20:11434/v1");
  assert.equal(resolveLocalBaseUrl("http://[::1]:8000/v1"), "http://[::1]:8000/v1");
  assert.equal(resolveLocalBaseUrl("https://api.example.com/v1"), null);
  assert.equal(resolveLocalBaseUrl("http://169.254.169.254/latest"), null);
  assert.equal(resolveLocalBaseUrl("file:///etc/passwd"), null);
  assert.equal(resolveLocalBaseUrl("http://user:pw@localhost/v1"), null);
  assert.ok(resolveLocalBaseUrl(""));
});
