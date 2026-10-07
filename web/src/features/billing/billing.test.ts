import assert from "node:assert/strict";
import test from "node:test";
import { licenseKind, signLicense, verifySignedLicense } from "./license";
import { FREE_REPO_LIMIT, canImport, parseImported, quotaStatus, withImported } from "./quota";

test("cuota Free: 2 repos distintos; el 3º se bloquea; reimportar no gasta; Pro no tiene tope", () => {
  assert.equal(FREE_REPO_LIMIT, 2);
  let imported: string[] = [];
  assert.ok(canImport("gh-a-b", imported, false));
  imported = withImported(imported, "gh-a-b");
  imported = withImported(imported, "local-app");
  imported = withImported(imported, "gh-a-b");
  assert.deepEqual(imported, ["gh-a-b", "local-app"]);
  assert.equal(quotaStatus(imported, false).remaining, 0);

  assert.equal(canImport("gh-c-d", imported, false), false, "tercer import sin licencia");
  assert.ok(canImport("gh-a-b", imported, false), "reimportar uno contado");
  assert.ok(canImport("gh-c-d", imported, true), "con licencia");
  assert.ok(canImport("demo_api_backend", imported, false), "las demos no pasan por la cuota");
  assert.equal(quotaStatus(imported, true).remaining, Number.POSITIVE_INFINITY);
});

test("parseImported: null si nunca se guardó (se siembra), filtra basura", () => {
  assert.equal(parseImported(null), null);
  assert.deepEqual(parseImported('["gh-a", 3, "demo_x", "local-b"]'), ["gh-a", "local-b"]);
  assert.deepEqual(parseImported("no-json"), []);
});

test("licencias firmadas: válida con el secreto, rechaza manipulación y caducidad", async () => {
  const key = await signLicense({ sub: "ana@example.com" }, "s3cret");
  assert.equal(licenseKind(key), "signed");
  const ok = await verifySignedLicense(key, "s3cret");
  assert.ok(ok.ok && ok.payload.sub === "ana@example.com");

  assert.deepEqual(await verifySignedLicense(key, "otro"), { ok: false, reason: "signature" });
  const [prefix, , signature] = key.split(".");
  const forged = `${prefix}.${Buffer.from(JSON.stringify({ sub: "mallory" })).toString("base64url")}.${signature}`;
  assert.deepEqual(await verifySignedLicense(forged, "s3cret"), { ok: false, reason: "signature" });

  const expired = await signLicense({ sub: "x", exp: 1000 }, "s3cret");
  assert.deepEqual(await verifySignedLicense(expired, "s3cret", 2000), { ok: false, reason: "expired" });
});

test("licenseKind: reconoce sesiones de Stripe y rechaza el resto", () => {
  assert.equal(licenseKind("cs_live_a1B2c3D4e5F6g7"), "stripe");
  assert.equal(licenseKind("cs_test_a1B2c3D4e5F6g7"), "stripe");
  assert.equal(licenseKind("PRO-123"), null);
  assert.equal(licenseKind(""), null);
});
