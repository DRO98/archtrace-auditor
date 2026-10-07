import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { AiProvider, CompleteJsonRequest } from "@llm/types";
import { sectionize } from "../docs/sections";
import { RepoIndex } from "../index/repoIndex";
import { runAudit } from "../pipeline";
import { createAuditFixture, FIXTURE_CLAUDE } from "../test/fixture";
import type { TestRepo } from "../test/gitRepo";
import { OllamaEmbedder, QdrantStore, type Embedder, type VectorConfig } from "./vector";
import { fuse, setupRetrieval } from "./vectorIndex";

/** Qdrant falso en memoria: los endpoints REST que usa `QdrantStore`, con búsqueda por coseno real. */
async function fakeQdrant(): Promise<{ server: Server; url: string; collections: Map<string, { size: number; points: Map<string, { vector: number[]; payload: Record<string, unknown> }> }>; calls: string[] }> {
  const collections = new Map<string, { size: number; points: Map<string, { vector: number[]; payload: Record<string, unknown> }> }>();
  const calls: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
      const url = new URL(request.url ?? "/", "http://x");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      calls.push(`${request.method} ${url.pathname}`);
      const reply = (status: number, result: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ result, status: status < 400 ? "ok" : "error", time: 0 }));
      };
      if (parts[0] !== "collections") return reply(404, null);
      if (parts.length === 1) return reply(200, { collections: [...collections.keys()].map((name) => ({ name })) });
      const name = parts[1]!;
      const collection = collections.get(name);
      if (parts.length === 2) {
        if (request.method === "GET") return collection ? reply(200, { config: { params: { vectors: { size: collection.size, distance: "Cosine" } } } }) : reply(404, null);
        if (request.method === "PUT") {
          collections.set(name, { size: (body.vectors as { size: number }).size, points: new Map() });
          return reply(200, true);
        }
        if (request.method === "DELETE") {
          collections.delete(name);
          return reply(200, true);
        }
      }
      if (!collection) return reply(404, null);
      const action = parts.slice(2).join("/");
      if (action === "points" && request.method === "PUT") {
        for (const point of body.points as Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>) {
          assert.equal(point.vector.length, collection.size);
          collection.points.set(point.id, { vector: point.vector, payload: point.payload });
        }
        return reply(200, { status: "completed" });
      }
      if (action === "points" && request.method === "POST") return reply(200, (body.ids as string[]).filter((id) => collection.points.has(id)).map((id) => ({ id })));
      if (action === "points/scroll") return reply(200, { points: [...collection.points.keys()].map((id) => ({ id })), next_page_offset: null });
      if (action === "points/delete") {
        for (const id of body.points as string[]) collection.points.delete(id);
        return reply(200, { status: "completed" });
      }
      if (action === "points/query") {
        const vector = body.query as number[];
        const excluded = ((body.filter as { must_not?: Array<{ key: string; match: { value: unknown } }> } | undefined)?.must_not ?? []).map((rule) => [rule.key, rule.match.value] as const);
        const hits = [...collection.points.entries()]
          .filter(([, point]) => !excluded.some(([key, value]) => point.payload[key] === value))
          .map(([id, point]) => ({ id, score: cosine(vector, point.vector), payload: point.payload }))
          .sort((left, right) => right.score - left.score)
          .slice(0, body.limit as number);
        return reply(200, { points: hits });
      }
      return reply(404, null);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, collections, calls };
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let a = 0;
  let b = 0;
  left.forEach((value, index) => {
    dot += value * (right[index] ?? 0);
    a += value * value;
    b += (right[index] ?? 0) ** 2;
  });
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

/**
 * Embedder determinista con "sinónimos": dimensiones por concepto, de modo que `has_perm` y "autorización" caen
 * cerca aunque no compartan ni una palabra (lo que BM25 no puede encontrar).
 */
const CONCEPTS: RegExp[] = [/perm|autoriz|acceso|forbidden|403|rol/i, /pago|importe|amount|cent|cobro/i, /css|estilo|color/i, /player|jugador/i];
function conceptEmbedder(): Embedder & { texts: string[] } {
  const texts: string[] = [];
  return {
    model: "fake-embed",
    texts,
    async embed(input) {
      texts.push(...input);
      return input.map((text) => [...CONCEPTS.map((concept) => (concept.test(text) ? 1 : 0)), 0.05]);
    },
  };
}

const ACCESS_DOC = `${FIXTURE_CLAUDE}
## Control de acceso

- Cualquier comprobación de autorización necesita doble revisión del equipo de seguridad.
`;

describe("RAG vectorial (Qdrant + embeddings)", () => {
  let qdrant: Awaited<ReturnType<typeof fakeQdrant>>;
  let repo: TestRepo;
  let home: string;

  before(async () => {
    qdrant = await fakeQdrant();
    ({ repo } = await createAuditFixture());
    repo.write("CLAUDE.md", ACCESS_DOC);
    await repo.git("add", "-A");
    await repo.git("commit", "-q", "--amend", "--no-edit");
    home = mkdtempSync(path.join(os.tmpdir(), "archtrace-home-"));
  });

  after(() => {
    qdrant.server.close();
    repo.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  const config = (): VectorConfig => ({ mode: "auto", qdrantUrl: qdrant.url, ollamaUrl: "", embedModel: "fake-embed" });

  async function retrievalFor(embedder: Embedder, warnings: string[] = []) {
    const index = RepoIndex.load(repo.root, { home });
    await index.refresh();
    const sections = index.docSections();
    const setup = await setupRetrieval({ repoRoot: repo.root, sections, index, warnings, config: config(), embedder, store: new QdrantStore(qdrant.url) });
    index.dispose();
    return { setup, sections };
  }

  it("indexa secciones de docs y símbolos, y la búsqueda híbrida encuentra reglas sin palabras en común", async () => {
    const embedder = conceptEmbedder();
    const { setup, sections } = await retrievalFor(embedder);
    assert.equal(setup.mode, "hybrid");
    assert.ok(setup.embedded > 0);
    const names = [...qdrant.collections.keys()];
    assert.equal(names.length, 2);
    assert.ok(names.some((name) => name.endsWith("_docs")) && names.some((name) => name.endsWith("_symbols")));
    const symbols = qdrant.collections.get(names.find((name) => name.endsWith("_symbols"))!)!;
    assert.ok([...symbols.points.values()].some((point) => point.payload.qualifiedName === "PlayerView.delete"));
    // Nunca por línea: un punto por sección y por símbolo.
    assert.equal(qdrant.collections.get(names.find((name) => name.endsWith("_docs"))!)!.points.size, sections.filter((section) => section.text.trim()).length);

    const query = 'if not request.user.has_perm("players.delete_player"):';
    const lexical = (await new (await import("./bm25")).Bm25Retriever(sections).search(query, 5)).map((hit) => hit.section.id);
    assert.ok(!lexical.includes("CLAUDE.md#control-de-acceso"), "BM25 no la encuentra");
    const hybrid = (await setup.retriever.search(query, 5)).map((hit) => hit.section.id);
    assert.ok(hybrid.includes("CLAUDE.md#control-de-acceso"), `híbrida sí: ${hybrid.join(", ")}`);

    const related = await setup.related!("permisos has_perm jugador", "players/views.py", 5);
    assert.ok(related.every((line) => !line.includes("players/views.py")), "excluye el propio archivo");
  });

  it("es incremental: un segundo arranque no vuelve a embeber nada; lo borrado del repo sale del índice", async () => {
    const embedder = conceptEmbedder();
    const { setup } = await retrievalFor(embedder);
    assert.equal(setup.embedded, 0);
    assert.ok(setup.reused > 0);
    assert.deepEqual(embedder.texts, ["probe"]);

    repo.write("CLAUDE.md", FIXTURE_CLAUDE);
    const docs = qdrant.collections.get([...qdrant.collections.keys()].find((name) => name.endsWith("_docs"))!)!;
    const before = docs.points.size;
    await retrievalFor(conceptEmbedder());
    assert.equal(docs.points.size, before - 1, "la sección borrada desaparece de Qdrant");
    repo.write("CLAUDE.md", ACCESS_DOC);
  });

  it("sin Qdrant o sin embeddings cae a BM25 (con aviso solo si Qdrant estaba arrancado)", async () => {
    const index = RepoIndex.load(repo.root, { home });
    await index.refresh();
    const sections = index.docSections();
    const quiet: string[] = [];
    const down = await setupRetrieval({ repoRoot: repo.root, sections, index, warnings: quiet, config: { ...config(), qdrantUrl: "http://127.0.0.1:9" } });
    assert.equal(down.mode, "bm25");
    assert.deepEqual(quiet, []);

    const loud: string[] = [];
    const noEmbeddings = await setupRetrieval({
      repoRoot: repo.root,
      sections,
      index,
      warnings: loud,
      config: config(),
      embedder: { model: "x", embed: async () => Promise.reject(new Error("model not found")) },
    });
    assert.equal(noEmbeddings.mode, "bm25");
    assert.match(loud.join(" "), /embeddings no disponibles/);

    const forced: string[] = [];
    await setupRetrieval({ repoRoot: repo.root, sections, index, warnings: forced, config: { ...config(), mode: "on", qdrantUrl: "http://127.0.0.1:9" } });
    assert.match(forced.join(" "), /Qdrant no responde/);
    index.dispose();
  });

  it("de punta a punta: la regla encontrada por vectores llega al prompt del LLM y a las métricas", async () => {
    const requests: CompleteJsonRequest[] = [];
    const provider: AiProvider = {
      id: "openai",
      model: "fake",
      async completeJson(request) {
        requests.push(request);
        return {
          value: { category: "authorization", criticality: "critical", confidence: 0.9, reason: "r", evidence: [], rule_refs: ["CLAUDE.md#control-de-acceso"], needs_more_context: false },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
      async completeText() {
        throw new Error("no se usa");
      },
    };
    const embedder = conceptEmbedder();
    // `runAudit` crea su propio embedder Ollama: se intercepta `fetch` solo para `/api/embed`.
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/embed")) {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return new Response(JSON.stringify({ embeddings: await embedder.embed(body.input, "document") }), { status: 200 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const { run } = await runAudit({
        repo: repo.root,
        mode: "commit",
        home,
        provider,
        write: false,
        vector: { mode: "on", qdrantUrl: qdrant.url, ollamaUrl: "http://127.0.0.1:11434", embedModel: "fake-embed" },
      });
      assert.equal(run.metrics.retrieval.mode, "hybrid");
      const views = requests.find((request) => request.user.includes("Archivo: players/views.py"))!;
      assert.match(views.user, /\[CLAUDE\.md#control-de-acceso\]/);
      const authz = run.findings.find((finding) => finding.file === "players/views.py")!;
      assert.ok(authz.rules.some((rule) => rule.sectionId === "CLAUDE.md#control-de-acceso"), "la regla citada se valida contra el índice");
      assert.deepEqual(run.warnings, []);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("piezas del RAG", () => {
  it("OllamaEmbedder: /api/embed con prefijos de tarea y lotes", async () => {
    const bodies: Array<{ model: string; input: string[] }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string; input: string[] };
        bodies.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ model: body.model, embeddings: body.input.map(() => [0.1, 0.2]) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const embedder = new OllamaEmbedder(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, "nomic-embed-text");
      const vectors = await embedder.embed(Array.from({ length: 40 }, (_, index) => `doc ${index}`), "document");
      assert.equal(vectors.length, 40);
      assert.equal(bodies.length, 2, "lotes de 32");
      assert.equal(bodies[0]!.model, "nomic-embed-text");
      assert.equal(bodies[0]!.input[0], "search_document: doc 0");
      await embedder.embed(["consulta"], "query");
      assert.equal(bodies[2]!.input[0], "search_query: consulta");
    } finally {
      server.close();
    }
  });

  it("fuse (RRF) premia lo que aparece en ambos rankings", () => {
    const [a, b, c] = sectionize("CLAUDE.md", "# A\n\n- debe a\n\n# B\n\n- debe b\n\n# C\n\n- debe c\n");
    const fused = fuse([[a!, b!], [c!, b!]], 3).map((hit) => hit.section.id);
    assert.equal(fused[0], b!.id);
  });
});
