import assert from "node:assert/strict";
import test from "node:test";
import { packageOf, rankSources, selectTopSources, sourceScore } from "@core/rankSources";
import { MAX_FILES, selectFiles } from "./importRepo";

test("sourceScore: un entrypoint en src/ gana al ruido y a la periferia", () => {
  assert.ok(sourceScore("src/app.ts") > sourceScore("a/helpers/util.ts"));
  assert.ok(sourceScore("src/server.py") > sourceScore("src/utils/format.py"));
  assert.ok(sourceScore("src/utils/format.py") > sourceScore("vendor/lodash/format.js"));
  assert.ok(sourceScore("src/api/users.ts") > sourceScore("src/api/users.test.ts"));
  assert.ok(sourceScore("src/db/models.py") > sourceScore("src/db/migrations/0001_initial.py"));
  assert.ok(sourceScore("src/proto/user.ts") > sourceScore("src/proto/user_pb2.py"));
  assert.ok(sourceScore("src/a.ts") > sourceScore("examples/demo/a.ts"));
  assert.ok(sourceScore("src/a.ts", 1000) > sourceScore("src/b.ts", 220 * 1024));
  assert.ok(sourceScore("src/a.ts") > sourceScore("src/a/b/c/d/e/f.ts"));
});

test("packageOf agrupa por paquete de monorepo, carpeta de primer nivel o raíz", () => {
  assert.equal(packageOf("packages/api/src/index.ts"), "packages/api");
  assert.equal(packageOf("apps/web/app/page.tsx"), "apps/web");
  assert.equal(packageOf("src/app.ts"), "src");
  assert.equal(packageOf("main.py"), "");
});

test("rankSources: en un monorepo los entrypoints de todos los paquetes entran antes que el relleno", () => {
  const noise = Array.from({ length: 500 }, (_, index) => ({ path: `a/generated-${String(index).padStart(3, "0")}.ts` }));
  const fill = Array.from({ length: 300 }, (_, index) => ({ path: `packages/billing/src/feature-${index}.ts` }));
  const entries = [
    { path: "src/app.ts" },
    { path: "packages/zeta/src/index.ts" },
    { path: "packages/yak/src/server.ts" },
    { path: "apps/web/app/page.tsx" },
  ];
  const { selected, skipped } = selectTopSources([...noise, ...fill, ...entries], MAX_FILES);
  const paths = new Set(selected.map((item) => item.path));
  assert.equal(selected.length, MAX_FILES);
  assert.equal(skipped, noise.length + fill.length + entries.length - MAX_FILES);
  for (const entry of entries) assert.ok(paths.has(entry.path), `falta ${entry.path}`);
  // No es "solo carpetas a*": el paquete billing también está representado.
  assert.ok(selected.some((item) => item.path.startsWith("packages/billing/")));
  // Devuelto en orden alfabético para que el grafo sea estable.
  assert.deepEqual(
    selected.map((item) => item.path),
    [...paths].sort((left, right) => left.localeCompare(right)),
  );
});

test("rankSources es determinista: empates por orden alfabético", () => {
  const items = [{ path: "src/b.ts" }, { path: "src/a.ts" }, { path: "lib/c.ts" }];
  assert.deepEqual(rankSources(items), rankSources([...items].reverse()));
});

test("selectFiles aplica el ranking cuando hay más fuentes que MAX_FILES", () => {
  const entry = (path: string) => ({ path, sha: path, size: 100 });
  const files = [...Array.from({ length: MAX_FILES + 50 }, (_, index) => entry(`aaa/mod_${index}.py`)), entry("zzz/src/main.py")];
  const result = selectFiles(files);
  assert.equal(result.selected.length, MAX_FILES);
  assert.equal(result.skipped, 51);
  assert.ok(result.selected.some((file) => file.path === "zzz/src/main.py"));
});

test("selectTopSources reserva cupo por paquete: una parte enorme no deja fuera a las demás", () => {
  // Un frontend con 600 archivos "de código" bien puntuados y dos partes pequeñas con archivos peores.
  const frontend = Array.from({ length: 600 }, (_, index) => ({ path: `parte4_frontend/src/api/handler${index}.ts` }));
  const small = Array.from({ length: 40 }, (_, index) => ({ path: `parte1_gestos/entrenamiento/deep/nested/mod${index}.py` }));
  const other = Array.from({ length: 40 }, (_, index) => ({ path: `parte2_plataforma/x/y/z/w/job${index}.py` }));
  const { selected } = selectTopSources([...frontend, ...small, ...other], MAX_FILES);
  const count = (prefix: string) => selected.filter((item) => item.path.startsWith(prefix)).length;
  assert.equal(selected.length, MAX_FILES);
  assert.ok(count("parte1_gestos/") >= 40, `gestos: ${count("parte1_gestos/")}`);
  assert.ok(count("parte2_plataforma/") >= 40, `plataforma: ${count("parte2_plataforma/")}`);
});

test("selectFiles devuelve aparte compose y README, sin gastar cupo de fuentes", () => {
  const entry = (path: string) => ({ path, sha: path, size: 100 });
  const result = selectFiles([entry("docker-compose.yml"), entry("README.md"), entry("a/README.md"), entry("a/b/README.md"), entry("a/main.py"), entry("b/app.ts")]);
  assert.deepEqual(result.selected.map((file) => file.path), ["a/main.py", "b/app.ts"]);
  assert.deepEqual(result.context.map((file) => file.path), ["README.md", "docker-compose.yml", "a/README.md"]);
  assert.deepEqual(result.parts, { included: 2, total: 2 });
});
