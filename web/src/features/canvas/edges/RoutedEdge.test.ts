import assert from "node:assert/strict";
import test from "node:test";
import { routedPath } from "./RoutedEdge";

test("routedPath redondea codos y alinea el primer/último tramo con los handles reales", () => {
  const points = [
    { x: 272, y: 368 },
    { x: 697, y: 368 },
    { x: 697, y: 92 },
    { x: 784, y: 92 },
  ];
  // Los handles de React Flow sobresalen unos píxeles del borde de la tarjeta.
  assert.equal(
    routedPath({ x: 277, y: 369 }, points, { x: 779, y: 91 }),
    "M 277,369 L 685,369 Q 697,369 697,357 L 697,103 Q 697,91 709,91 L 779,91",
  );
});

test("routedPath: tramo recto vertical y sin ruta", () => {
  assert.equal(routedPath({ x: 136, y: 85 }, [{ x: 136, y: 80 }, { x: 136, y: 200 }], { x: 136, y: 195 }), "M 136,85 L 136,195");
  assert.equal(routedPath({ x: 0, y: 0 }, [], { x: 1, y: 1 }), null);
});
