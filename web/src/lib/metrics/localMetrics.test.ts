import assert from "node:assert/strict";
import test from "node:test";
import { applyMetric, emptyMetrics, markCanvasOpened, markImportFinished, markImportStarted } from "./localMetrics";

test("applyMetric cuenta imports y guarda como mucho 20 muestras de tiempo a Level 0", () => {
  let metrics = emptyMetrics();
  metrics = applyMetric(metrics, { type: "import-started" });
  metrics = applyMetric(metrics, { type: "import-completed" });
  metrics = applyMetric(metrics, { type: "import-failed" });
  for (let index = 0; index < 25; index += 1) metrics = applyMetric(metrics, { type: "level0-shown", ms: index + 0.4 });
  assert.equal(metrics.importsStarted, 1);
  assert.equal(metrics.importsCompleted, 1);
  assert.equal(metrics.importsFailed, 1);
  assert.equal(metrics.timeToLevel0Ms.length, 20);
  assert.deepEqual(metrics.timeToLevel0Ms.slice(0, 2), [5, 6]);
});

test("el tiempo a Level 0 se mide solo para el grafo recién importado y una vez", () => {
  markImportStarted(1_000);
  markImportFinished("gh-acme-api");
  assert.equal(markCanvasOpened("gh-otro", true, 5_000), null);
  assert.equal(markCanvasOpened("gh-acme-api", true, 4_500), 3_500);
  assert.equal(markCanvasOpened("gh-acme-api", true, 9_000), null);
});

test("un grafo que abre directo en el detalle, o un import fallido, no dejan muestra", () => {
  markImportStarted(0);
  markImportFinished("local-mini");
  assert.equal(markCanvasOpened("local-mini", false, 100), null);
  markImportStarted(0);
  markImportFinished(null);
  assert.equal(markCanvasOpened("local-mini", true, 100), null);
});
