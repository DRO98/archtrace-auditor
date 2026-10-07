import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PER_PROVIDER, shortlistModels } from "./modelShortlist";

const ids = (items: readonly { id: string }[]): string[] => items.map((item) => item.id);

test("shortlistModels pone los del catálogo primero y corta en MAX_PER_PROVIDER", () => {
  const served = [...Array.from({ length: 10 }, (_, index) => ({ id: `ft-${index}` })), { id: "gpt-4o-mini" }, { id: "gpt-4o" }];
  const { shortlist, rest } = shortlistModels("openai", served);
  assert.equal(shortlist.length, MAX_PER_PROVIDER);
  assert.deepEqual(ids(shortlist).slice(0, 3), ["gpt-4o", "gpt-4o-mini", "ft-0"]);
  assert.deepEqual(ids(rest), ["ft-6", "ft-7", "ft-8", "ft-9"]);
});

test("shortlistModels mantiene visible el modelo elegido aunque quede fuera del corte", () => {
  const served = Array.from({ length: 12 }, (_, index) => ({ id: `m-${index}` }));
  const { shortlist, rest } = shortlistModels("groq", served, { keep: "m-10" });
  assert.deepEqual(ids(shortlist), ["m-0", "m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-7", "m-10"]);
  assert.deepEqual(ids(rest), ["m-8", "m-9", "m-11"]);
});
