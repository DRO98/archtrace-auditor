import assert from "node:assert/strict";
import test from "node:test";
import { NO_PADDING, PANEL_GAP, STEP_BAR_PADDING_TOP, stepCenterPoint, stepViewPadding } from "./fitNode";

const CARD = { x: 100, y: 200, width: 272, height: 80 };

test("sin paneles, setCenter apunta al centro geométrico del nodo", () => {
  assert.deepEqual(stepCenterPoint(CARD, 0.85, NO_PADDING), { x: 236, y: 240 });
});

test("un panel superpuesto y la barra de pasos desplazan el objetivo para dejar el nodo en el área libre", () => {
  const point = stepCenterPoint(CARD, 0.85, { top: 100, right: 420, bottom: 0, left: 100 });
  assert.ok(Math.abs(point.x - (236 + 320 / 1.7)) < 1e-9);
  assert.ok(Math.abs(point.y - (240 - 100 / 1.7)) < 1e-9);
});

test("paddings simétricos no mueven el objetivo", () => {
  assert.deepEqual(stepCenterPoint(CARD, 0.85, { top: 50, right: 80, bottom: 50, left: 80 }), { x: 236, y: 240 });
});

test("la columna derecha en el flex no solapa el lienzo: no suma padding", () => {
  assert.deepEqual(stepViewPadding({ rightOverlap: 0, stepBarOpen: false }), NO_PADDING);
  assert.deepEqual(stepViewPadding({ rightOverlap: 0, stepBarOpen: true }), { ...NO_PADDING, top: STEP_BAR_PADDING_TOP });
  assert.deepEqual(stepViewPadding({ rightOverlap: 400, stepBarOpen: true }), {
    ...NO_PADDING,
    top: STEP_BAR_PADDING_TOP,
    right: 400 + PANEL_GAP,
  });
});
