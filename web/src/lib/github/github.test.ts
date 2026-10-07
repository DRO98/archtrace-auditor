import assert from "node:assert/strict";
import test from "node:test";
import { buildGraphFromSources } from "./buildGraph";
import { parseRepoRef } from "./client";
import { MAX_FILE_BYTES, selectFiles } from "./importRepo";
import { isSensitivePath, sensitiveReason } from "./sensitiveFilter";

test("el filtro excluye carpetas, .env, claves y secretos antes de descargar", () => {
  assert.equal(sensitiveReason(".git/config"), "directory");
  assert.equal(sensitiveReason("web/node_modules/react/index.js"), "directory");
  assert.equal(sensitiveReason(".env"), "env");
  assert.equal(sensitiveReason("api/.env.production"), "env");
  assert.equal(sensitiveReason("certs/server.pem"), "key");
  assert.equal(sensitiveReason("deploy/id_rsa"), "credentials");
  assert.equal(sensitiveReason("config/secrets.json"), "credentials");
  assert.equal(isSensitivePath(".env.example"), false);
  assert.equal(isSensitivePath("src/app/secretary.ts"), false);
  assert.equal(isSensitivePath("src/rag/pipeline.py"), false);
});

test("parseRepoRef acepta owner/repo, @rama y URLs de GitHub", () => {
  assert.deepEqual(parseRepoRef("acme/api"), { owner: "acme", repo: "api" });
  assert.deepEqual(parseRepoRef("acme/api@dev"), { owner: "acme", repo: "api", ref: "dev" });
  assert.deepEqual(parseRepoRef("https://github.com/acme/api.git"), { owner: "acme", repo: "api" });
  assert.deepEqual(parseRepoRef("github.com/acme/api/tree/feature/x"), { owner: "acme", repo: "api", ref: "feature/x" });
  assert.equal(parseRepoRef("no es un repo"), null);
});

test("selectFiles descarta secretos, no-fuentes y archivos enormes", () => {
  const entry = (path: string, size = 100) => ({ path, sha: path, size });
  const result = selectFiles([
    entry("src/a.ts"),
    entry(".env"),
    entry("keys/prod.pem"),
    entry("README.md"),
    entry("src/huge.py", MAX_FILE_BYTES + 1),
    entry("node_modules/x/index.js"),
  ]);
  assert.deepEqual(result.selected.map((file) => file.path), ["src/a.ts"]);
  assert.equal(result.sensitive, 3);
  assert.equal(result.tooLarge, 1);
});

test("buildGraphFromSources une módulos TS y Python por sus imports", () => {
  const graph = buildGraphFromSources(
    "acme/api",
    new Map([
      ["src/api/routes.ts", 'import { run } from "../rag/pipeline";\nexport function handler() {}\n'],
      ["src/rag/pipeline.ts", "export const run = async () => {};\n"],
      ["tools/a.py", "from tools.b import B\n\ndef main():\n    pass\n"],
      ["tools/b.py", "class B:\n    pass\n"],
    ]),
  );
  assert.equal(graph.modules.length, 4);
  assert.deepEqual(
    graph.edges.map((edge) => [edge.source, edge.target]),
    [
      ["src/api/routes.ts", "src/rag/pipeline.ts"],
      ["tools/a.py", "tools/b.py"],
    ],
  );
  const routes = graph.modules.find((item) => item.id === "src/api/routes.ts");
  assert.deepEqual(routes?.subBlocks.map((block) => block.name), ["handler"]);
  assert.equal(routes?.groupId, "api");
});

test("buildGraphFromSources resuelve imports Python de scripts: hermano y nombre único en el repo", () => {
  const graph = buildGraphFromSources(
    "acme/bots",
    new Map([
      ["bot_rag/app.py", "import fabrica\nfrom agente import Turno\n"],
      ["bot_rag/fabrica.py", "from cifras import formatear\n"],
      ["bot/agente.py", "class Turno:\n    pass\n"],
      ["bot/cifras.py", "def formatear():\n    pass\n"],
      ["bot/tests/cifras.py", "def formatear():\n    pass\n"],
      ["otro/json.py", "x = 1\n"],
      ["otra/json.py", "x = 2\n"],
      ["bot/main.py", "import json\n"],
    ]),
  );
  const edges = graph.edges.map((edge) => `${edge.source} -> ${edge.target}`);
  assert.ok(edges.includes("bot_rag/app.py -> bot_rag/fabrica.py"), "módulo hermano");
  assert.ok(edges.includes("bot_rag/app.py -> bot/agente.py"), "único agente.py del repo (PYTHONPATH)");
  assert.ok(edges.includes("bot_rag/fabrica.py -> bot/cifras.py"), "los tests no cuentan como candidato");
  assert.ok(!edges.some((edge) => edge.startsWith("bot/main.py")), "con varios candidatos no se adivina");
});
