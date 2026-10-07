import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCodeGraph } from "./graph";
import { layoutGraph } from "./layout";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SUPPORT_LABEL,
  SUPPORT_SIZE,
  SUPPORT_SLOT,
  supportHandlePercent,
} from "../theme";

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x + a.w > b.x + 0.5 && b.x + b.w > a.x + 0.5 && a.y + a.h > b.y + 0.5 && b.y + b.h > a.y + 0.5;
}

test("layoutGraph coloca macro_rag_project sin solapes", () => {
  const raw: unknown = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "public/graphs/macro_rag_project.json"), "utf8"),
  );
  const parsed = parseCodeGraph(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("grafo inválido");

  const positions = layoutGraph(parsed.graph);
  const boxes: Box[] = [];

  for (const item of parsed.graph.modules) {
    const position = positions.get(item.id);
    assert.ok(position, item.id);
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
    if (item.supportOf) {
      const slotX = position.x - (SUPPORT_SLOT - SUPPORT_SIZE) / 2;
      boxes.push({
        id: item.id,
        x: slotX,
        y: position.y,
        w: SUPPORT_SLOT,
        h: SUPPORT_SIZE + SUPPORT_LABEL,
      });
    } else {
      boxes.push({ id: item.id, x: position.x, y: position.y, w: CARD_WIDTH, h: CARD_HEIGHT });
    }
  }

  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      if (!a || !b) continue;
      assert.equal(overlaps(a, b), false, `${a.id} solapa ${b.id}`);
    }
  }

  const byId = new Map(parsed.graph.modules.map((item) => [item.id, item]));
  const children = new Map<string, string[]>();
  for (const item of parsed.graph.modules) {
    if (!item.supportOf) continue;
    const list = children.get(item.supportOf) ?? [];
    list.push(item.id);
    children.set(item.supportOf, list);
  }
  for (const [parentId, ids] of children) {
    const parent = positions.get(parentId);
    assert.ok(parent);
    const parentCenter = parent.x + CARD_WIDTH / 2;
    const centers = ids.map((id) => {
      const placed = positions.get(id);
      assert.ok(placed);
      return placed.x + SUPPORT_SIZE / 2;
    });
    const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
    assert.ok(Math.abs(mid - parentCenter) <= 1, `${parentId} no centra sus sub-nodos`);
    const parentModule = byId.get(parentId);
    assert.ok(parentModule);
  }
});

test("supportHandlePercent queda entre 10 y 90", () => {
  for (let count = 1; count <= 6; count += 1) {
    for (let index = 0; index < count; index += 1) {
      const percent = supportHandlePercent(index, count);
      assert.ok(percent >= 10 && percent <= 90, `n=${count} i=${index} → ${percent}`);
    }
  }
});
