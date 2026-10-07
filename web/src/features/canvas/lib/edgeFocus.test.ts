import assert from "node:assert/strict";
import test from "node:test";
import type { Edge } from "@xyflow/react";
import { IMPACT_HOVER_STROKE, IMPACT_STROKE, paintEdges } from "./edgeFocus";
import { EDGE_STYLE } from "../theme";

const edges: Edge[] = [
  { id: "a-b", source: "a", target: "b", type: "routed", style: { stroke: "#3b82f6", strokeWidth: 2, strokeOpacity: 0.8 } },
  { id: "b-c", source: "b", target: "c", type: "routed", style: { stroke: "#8b5cf6", strokeWidth: 2, strokeOpacity: 0.8 } },
  { id: "c-d", source: "c", target: "d", type: "routed", style: { stroke: "#f43f5e", strokeWidth: 2, strokeOpacity: 0.8 } },
];
const none = { selectedModuleId: null, hover: null, affectedEdgeIds: null };
const styleOf = (list: Edge[], id: string) => list.find((edge) => edge.id === id)?.style ?? {};

test("sin foco las aristas se devuelven tal cual", () => {
  assert.equal(paintEdges(edges, none), edges);
});

test("nodo seleccionado: sus cables se engrosan, conservan color y se animan; el resto se atenúa", () => {
  const painted = paintEdges(edges, { ...none, selectedModuleId: "b" });
  for (const id of ["a-b", "b-c"]) {
    const style = styleOf(painted, id);
    assert.equal(style.strokeWidth, EDGE_STYLE.focusWidth);
    assert.equal(style.strokeOpacity, 1);
    assert.ok(style.animationName, `${id} animada`);
  }
  assert.equal(styleOf(painted, "a-b").stroke, "#3b82f6");
  assert.equal(styleOf(painted, "c-d").opacity, EDGE_STYLE.dimmedOpacity);
});

test("el hover manda sobre la selección y no anima", () => {
  const painted = paintEdges(edges, { ...none, selectedModuleId: "b", hover: { kind: "module", id: "d" } });
  assert.equal(styleOf(painted, "c-d").strokeWidth, EDGE_STYLE.focusWidth);
  assert.equal(styleOf(painted, "c-d").animationName, undefined);
  assert.equal(styleOf(painted, "a-b").opacity, EDGE_STYLE.dimmedOpacity);
});

test("hover sobre un cable resalta solo ese cable", () => {
  const painted = paintEdges(edges, { ...none, hover: { kind: "edge", id: "b-c" } });
  assert.equal(styleOf(painted, "b-c").strokeWidth, EDGE_STYLE.focusWidth);
  assert.equal(painted.find((edge) => edge.id === "b-c")?.zIndex, 1);
  assert.equal(styleOf(painted, "a-b").opacity, EDGE_STYLE.dimmedOpacity);
});

test("el análisis de impacto manda sobre todo", () => {
  const painted = paintEdges(edges, { selectedModuleId: "a", hover: { kind: "edge", id: "a-b" }, affectedEdgeIds: new Set(["c-d"]) });
  assert.equal(styleOf(painted, "c-d").stroke, IMPACT_STROKE);
  assert.equal(styleOf(painted, "a-b").opacity, EDGE_STYLE.dimmedOpacity);
});

test("impacto: el cable en hover desde el panel se engrosa sobre los afectados", () => {
  const painted = paintEdges(edges, { ...none, affectedEdgeIds: new Set(["b-c", "c-d"]), impactHoverEdgeId: "c-d" });
  assert.equal(styleOf(painted, "c-d").strokeWidth, EDGE_STYLE.focusWidth + 2);
  assert.equal(styleOf(painted, "c-d").stroke, IMPACT_STROKE);
  assert.equal(styleOf(painted, "b-c").strokeWidth, EDGE_STYLE.focusWidth);
  assert.equal(styleOf(painted, "a-b").opacity, EDGE_STYLE.dimmedOpacity);
});

test("impacto: un cable de entrada en hover se resalta aunque no esté aguas abajo", () => {
  const painted = paintEdges(edges, { ...none, affectedEdgeIds: new Set(["b-c"]), impactHoverEdgeId: "a-b" });
  assert.equal(styleOf(painted, "a-b").stroke, IMPACT_HOVER_STROKE);
  assert.equal(styleOf(painted, "a-b").opacity, 1);
});
