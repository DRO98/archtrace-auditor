import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfter, retryDelay, withTransientRetry } from "./retry";

function httpError(status: number, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
}

test("retryDelay reintenta 429, 5xx y 529 pero no 4xx", () => {
  assert.ok((retryDelay(httpError(503), 0) ?? 0) > 0);
  assert.ok((retryDelay(httpError(529), 0) ?? 0) > 0);
  assert.ok((retryDelay(httpError(429), 0) ?? 0) > 0);
  assert.equal(retryDelay(httpError(401), 0), null);
  assert.equal(retryDelay(new Error("sin estado"), 0), null);
});

test("retryDelay respeta retry-after corto y no espera cuotas largas", () => {
  assert.equal(retryDelay(httpError(429, { retryAfterMs: 2000 }), 0), 2000);
  assert.equal(retryDelay(httpError(429, { retryAfterMs: 60_000 }), 0), null);
  assert.equal(parseRetryAfter("1.5"), 1500);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"), null);
});

test("withTransientRetry reintenta una vez un 503 y devuelve el segundo intento", async () => {
  let calls = 0;
  const value = await withTransientRetry(async () => {
    calls += 1;
    if (calls === 1) throw httpError(503, { retryAfterMs: 1 });
    return "ok";
  }, new AbortController().signal);
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("withTransientRetry no reintenta un 401", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      calls += 1;
      throw httpError(401);
    }, new AbortController().signal),
  );
  assert.equal(calls, 1);
});
