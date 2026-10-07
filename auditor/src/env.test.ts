import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadAuditorEnv } from "./env";

test("auditor/.env carga claves sin pisar las del entorno", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "archtrace-env-"));
  const file = path.join(directory, ".env");
  writeFileSync(file, "ARCHTRACE_TEST_NEW=desde-archivo\nARCHTRACE_TEST_KEEP=desde-archivo\n");
  const saved = { file: process.env.ARCHTRACE_ENV_FILE, keep: process.env.ARCHTRACE_TEST_KEEP };
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of [["ARCHTRACE_ENV_FILE", saved.file], ["ARCHTRACE_TEST_KEEP", saved.keep]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.ARCHTRACE_TEST_NEW;
  });
  process.env.ARCHTRACE_ENV_FILE = file;
  process.env.ARCHTRACE_TEST_KEEP = "del-entorno";
  assert.equal(loadAuditorEnv(), file);
  assert.equal(process.env.ARCHTRACE_TEST_NEW, "desde-archivo");
  assert.equal(process.env.ARCHTRACE_TEST_KEEP, "del-entorno");
});
