import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ModuleSubsystem } from "@core/graph";
import { inferLayerAndSubsystem, STAGE } from "../../src/features/canvas/lib/subsystems";
import type { AiProvider, CompleteJsonRequest } from "../../src/lib/ai/types";
import { buildClassifierUserMessage, digestPythonModule, parseClassifications, resolveSubsystemName } from "./aiClassifier";
import { ClassificationCache } from "./classificationCache";
import { classifyModules, type ModuleInput } from "./classifyModules";

const PROCESSOR = `"""Limpia y trocea texto crudo antes de indexarlo."""
import re
from typing import List

class ProcessorV2:
    def run(self, text: str) -> List[str]:
        return re.split(r"\\n\\n", text)
`;

function fakeProvider(answer: (request: CompleteJsonRequest) => unknown): AiProvider & { calls: CompleteJsonRequest[] } {
  const calls: CompleteJsonRequest[] = [];
  return {
    id: "gemini",
    model: "fake-flash",
    calls,
    async completeJson(request) {
      calls.push(request);
      return answer(request);
    },
    async completeText() {
      throw new Error("completeText no se usa al clasificar módulos");
    },
  };
}

function input(filePath: string, source: string, role: ModuleInput["role"] = "code"): ModuleInput {
  return { path: filePath, source, label: path.basename(filePath), role, blocks: [{ kind: "class", startLine: 5 }, { kind: "method", startLine: 6 }] };
}

function withCache<T>(run: (cache: ClassificationCache, file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "classify-"));
  const file = path.join(dir, ".cache", "module-layers.json");
  return run(ClassificationCache.load(file), file).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("inferLayerAndSubsystem devuelve null sin coincidencia de alta confianza", () => {
  assert.equal(inferLayerAndSubsystem("core/misc/processor_v2.py"), null);
  assert.equal(inferLayerAndSubsystem("src/utils/helpers.py"), null);
  assert.deepEqual(inferLayerAndSubsystem("src/rag/chunker.py"), { layer: STAGE.preprocess, subsystem: "rag-core" });
  assert.deepEqual(inferLayerAndSubsystem("src/api/routes.py"), { layer: STAGE.entry, subsystem: "ingress" });
  assert.deepEqual(inferLayerAndSubsystem("src/events/kafka_producer.py", "broker"), { layer: STAGE.index, subsystem: "messaging" });
  assert.deepEqual(inferLayerAndSubsystem("src/cache/redis_client.py", "cache"), { layer: STAGE.index, subsystem: "data" });
});

test("digestPythonModule solo envía ruta, imports, firmas y docstring", () => {
  const digest = digestPythonModule("core/misc/processor_v2.py", PROCESSOR, [{ kind: "class", startLine: 5 }, { kind: "method", startLine: 6 }]);
  assert.deepEqual(digest.imports, ["import re", "from typing import List"]);
  assert.deepEqual(digest.signatures, ["class ProcessorV2:", "def run(self, text: str) -> List[str]:"]);
  assert.equal(digest.doc, "Limpia y trocea texto crudo antes de indexarlo.");
  const message = buildClassifierUserMessage([digest]);
  assert.ok(message.startsWith("[0] core/misc/processor_v2.py"));
  assert.ok(!message.includes("re.split"), "el cuerpo de las funciones no viaja");
});

test("parseClassifications descarta capas o índices fuera de rango", () => {
  const parsed = parseClassifications(
    {
      modules: [
        { index: 0, layer: 1, subsystem: "Ingestion", reasoning: "trocea texto" },
        { index: 1, layer: 7, subsystem: "X", reasoning: "" },
        { index: 9, layer: 2, subsystem: "Y", reasoning: "" },
        { index: 2, layer: 3, subsystem: "  ", reasoning: "" },
      ],
    },
    3,
  );
  assert.deepEqual([...parsed.keys()], [0]);
});

test("resolveSubsystemName reutiliza el catálogo o crea uno nuevo", () => {
  const extra: ModuleSubsystem[] = [];
  assert.equal(resolveSubsystemName("Storage", extra), "data");
  assert.equal(resolveSubsystemName("Docker runtime", extra), "infra");
  assert.equal(resolveSubsystemName("RAG", extra), "rag-core");
  assert.equal(resolveSubsystemName("Ingestion", extra), "ingestion");
  assert.equal(resolveSubsystemName("Ingestion", extra), "ingestion");
  assert.equal(extra.length, 1);
  assert.equal(extra[0]?.label, "Ingestion");
});

test("classifyModules: heurística primero, un solo lote para el resto y caché en la segunda pasada", async () => {
  await withCache(async (cache, file) => {
    const provider = fakeProvider(() => ({
      modules: [
        { index: 0, layer: 1, subsystem: "Ingestion", reasoning: "limpia texto" },
        { index: 1, layer: 3, subsystem: "Orchestration", reasoning: "coordina" },
      ],
    }));
    const inputs = [
      input("src/rag/chunker.py", "def chunk_text(): pass\n", "transform"),
      input("core/misc/processor_v2.py", PROCESSOR),
      input("core/misc/runner.py", "class Runner:\n    pass\n"),
    ];

    const first = await classifyModules(inputs, { provider, cache });
    assert.equal(provider.calls.length, 1);
    assert.equal(first.byPath.get("src/rag/chunker.py")?.source, "heuristic");
    assert.deepEqual(first.byPath.get("core/misc/processor_v2.py"), { layer: 1, subsystem: "ingestion", source: "ai" });
    assert.deepEqual(first.byPath.get("core/misc/runner.py"), { layer: 3, subsystem: "orchestration", source: "ai" });
    assert.deepEqual(first.extraSubsystems.map((item) => item.id), ["ingestion", "orchestration"]);

    const second = await classifyModules(inputs, { provider, cache: ClassificationCache.load(file) });
    assert.equal(provider.calls.length, 1, "la segunda pasada sale de la caché");
    assert.equal(second.byPath.get("core/misc/processor_v2.py")?.source, "cache");

    const edited = [input("core/misc/processor_v2.py", `${PROCESSOR}\n# cambio\n`)];
    await classifyModules(edited, { provider, cache: ClassificationCache.load(file) });
    assert.equal(provider.calls.length, 2, "cambiar el contenido invalida la entrada");
  });
});

test("classifyModules no rompe el build si la IA falla o no hay proveedor", async () => {
  await withCache(async (cache) => {
    const failing = fakeProvider(() => {
      throw new Error("503");
    });
    const inputs = [input("core/misc/processor_v2.py", PROCESSOR)];
    const logs: string[] = [];
    const failed = await classifyModules(inputs, { provider: failing, cache, log: (message) => logs.push(message) });
    assert.deepEqual(failed.byPath.get("core/misc/processor_v2.py"), { source: "unresolved" });
    assert.ok(logs.some((message) => message.includes("Falló")));

    const offline = await classifyModules(inputs, { provider: null, cache });
    assert.deepEqual(offline.byPath.get("core/misc/processor_v2.py"), { source: "unresolved" });
  });
});
