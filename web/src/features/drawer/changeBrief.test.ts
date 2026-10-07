import assert from "node:assert/strict";
import test from "node:test";
import { addBrief, buildCursorPrompt, countByDepth, MAX_PATHS_PER_SECTION, MAX_SAVED_BRIEFS, parseBriefs, type SavedBrief } from "./lib/changeBrief";

const origin = { label: "Orders service", filePath: "src/services/orders.ts" };

test("buildCursorPrompt: acota a origen + blast radius y protege a los consumidores", () => {
  const prompt = buildCursorPrompt({
    goal: "add pagination",
    origin,
    outgoing: [
      { label: "Orders repo", filePath: "src/db/orders.ts", depth: 1 },
      { label: "Pool", filePath: "src/db/pool.ts", depth: 2 },
    ],
    callers: [{ label: "Orders API", filePath: "src/api/orders.ts" }],
    riskLabel: "Moderate",
    finding: { title: "Critical hub: Orders service", fixHint: "Freeze its interface" },
    lang: "en",
  });
  assert.match(prompt, /^# Change brief: add pagination/);
  assert.match(prompt, /1 direct, 1 cascade, 1 caller/);
  assert.match(prompt, /Critical hub: Orders service/);
  // Cada ruta en su sección: directo para adaptar, cascada solo verificar, consumidores en "no romper".
  const adapt = prompt.indexOf("direct dependents");
  const verify = prompt.indexOf("Verify only");
  const contract = prompt.indexOf("Do not break");
  assert.ok(adapt < prompt.indexOf("`src/db/orders.ts`") && prompt.indexOf("`src/db/orders.ts`") < verify);
  assert.ok(verify < prompt.indexOf("`src/db/pool.ts`") && prompt.indexOf("`src/db/pool.ts`") < contract);
  assert.ok(contract < prompt.indexOf("`src/api/orders.ts`"));
  assert.match(prompt, /Do not modify any file outside/);
});

test("buildCursorPrompt: determinista, en español y con tope de rutas", () => {
  const outgoing = Array.from({ length: MAX_PATHS_PER_SECTION + 5 }, (_, index) => ({ label: `m${index}`, filePath: `src/m${String(index).padStart(2, "0")}.ts`, depth: 1 }));
  const input = { goal: "", origin, outgoing, callers: [], riskLabel: "Crítico", lang: "es" as const };
  const prompt = buildCursorPrompt(input);
  assert.equal(prompt, buildCursorPrompt(input));
  assert.match(prompt, /# Brief de cambio: \(describe aquí el cambio\)/);
  assert.match(prompt, /…y 5 más/);
  assert.match(prompt, /No romper[\s\S]*- \(ninguno\)/);
});

test("countByDepth agrupa por nivel ordenado", () => {
  assert.deepEqual(countByDepth([{ depth: 2 }, { depth: 1 }, { depth: 2 }]), [
    { depth: 1, count: 1 },
    { depth: 2, count: 2 },
  ]);
});

test("addBrief: más nuevo primero, sin duplicar objetivo+módulo y con tope", () => {
  const brief = (id: string, goal: string, originId = "x"): SavedBrief => ({ id, createdAt: Number(id), goal, originId, originLabel: originId, prompt: id });
  let list: SavedBrief[] = [];
  for (let index = 0; index < MAX_SAVED_BRIEFS + 2; index += 1) list = addBrief(list, brief(String(index), `goal ${index}`));
  assert.equal(list.length, MAX_SAVED_BRIEFS);
  assert.equal(list[0]!.id, String(MAX_SAVED_BRIEFS + 1));
  list = addBrief(list, brief("99", "goal 5"));
  assert.equal(list.filter((item) => item.goal === "goal 5").length, 1);
  assert.equal(list[0]!.id, "99");
  assert.deepEqual(parseBriefs(JSON.stringify(list)), list);
  assert.deepEqual(parseBriefs("{roto"), []);
});
