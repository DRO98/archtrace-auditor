import type { CodeGraph } from "@core/graph";
import { buildModule, buildSteps, edge, latency } from "../lib/build";
import type { DemoDefinition } from "../types";

const ROUTES = "app/api/products_routes.py";
const AUTH = "app/middleware/auth.py";
const SERVICE = "app/domain/catalog_service.py";
const REPO = "app/db/products_repository.py";
const CACHE = "app/cache/redis_cache.py";
const PRICING = "app/clients/pricing_client.py";

const graph: CodeGraph = {
  version: 1,
  projectName: "Demo · API Backend (FastAPI + Postgres + Redis)",
  groups: [
    { id: "api", label: "API", color: "sky" },
    { id: "domain", label: "Dominio", color: "violet" },
    { id: "data", label: "Datos", color: "emerald" },
    { id: "clients", label: "Clientes externos", color: "amber" },
  ],
  subsystems: [{ id: "data", label: "Datos · Postgres y Redis", color: "emerald" }],
  modules: [
    buildModule({
      id: ROUTES,
      label: "Products API",
      groupId: "api",
      role: "api",
      layer: 0,
      summary: "Endpoints REST de catálogo: GET /products/{id} y POST /products.",
      blocks: [
        ["get_product", 18, 34, "GET /products/{id}: caché primero, luego base de datos."],
        ["create_product", 36, 58, "POST /products: valida y persiste."],
      ],
    }),
    buildModule({
      id: AUTH,
      label: "Auth Middleware",
      groupId: "api",
      role: "service",
      layer: 0,
      supportOf: ROUTES,
      summary: "Valida el JWT y añade el usuario a la petición.",
      blocks: [["verify_jwt", 9, 31, "Firma, caducidad y scopes."]],
    }),
    buildModule({
      id: SERVICE,
      label: "Catalog Service",
      groupId: "domain",
      role: "service",
      layer: 3,
      summary: "Reglas de catálogo: precio final, disponibilidad e invalidación de caché.",
      blocks: [["CatalogService", 10, 80], ["CatalogService.get", 20, 46, "Caché → BD → precio dinámico."]],
    }),
    buildModule({
      id: REPO,
      label: "Products Repository",
      groupId: "data",
      role: "database",
      layer: 2,
      subsystem: "data",
      summary: "SQLAlchemy sobre Postgres (tabla products).",
      blocks: [["find_by_id", 12, 27, "SELECT … WHERE id = :id."]],
    }),
    buildModule({
      id: CACHE,
      label: "Redis Cache",
      groupId: "data",
      role: "cache",
      layer: 2,
      subsystem: "data",
      summary: "Caché de productos con TTL de 60 s.",
      blocks: [["get_cached", 7, 19, "GET product:<id>."]],
    }),
    buildModule({
      id: PRICING,
      label: "Pricing Client",
      groupId: "clients",
      role: "service",
      layer: 2,
      summary: "Cliente HTTP del servicio de precios dinámicos (timeout 800 ms, 1 reintento).",
      blocks: [["quote", 11, 36, "POST /quote con reintento y circuit breaker."]],
    }),
  ],
  edges: [
    edge(ROUTES, AUTH, "calls", "verify"),
    edge(ROUTES, SERVICE, "calls", "get()"),
    edge(SERVICE, CACHE, "calls", "GET"),
    edge(SERVICE, REPO, "calls", "SELECT"),
    edge(SERVICE, PRICING, "calls", "POST /quote"),
  ],
};

export const API_BACKEND_DEMO: DemoDefinition = {
  graphName: "demo_api_backend",
  title: "API Backend",
  tagline: "FastAPI con dominio, Postgres, Redis y un servicio externo de precios",
  graph,
  scenarios: {
    version: 1,
    graph: "demo_api_backend",
    scenarios: [
      {
        id: "get-product-cache-miss",
        name: "GET /products/{id} con fallo de caché",
        description: "La caché no tiene el producto: se lee de Postgres y se pide el precio dinámico.",
        entryNodeId: ROUTES,
        steps: buildSteps(graph, [
          {
            nodeId: ROUTES,
            block: "get_product",
            title: "Llega la petición",
            description: "FastAPI enruta GET /products/42 y valida el JWT.",
            input: { method: "GET", path: "/products/42" },
            output: { productId: 42 },
            metrics: latency(4, { httpStatus: 200 }),
          },
          {
            nodeId: SERVICE,
            block: "CatalogService.get",
            title: "El dominio orquesta",
            description: "Primero la caché; si falla, la base de datos y el precio dinámico.",
            input: { productId: 42 },
            output: { strategy: "cache → db → pricing" },
            metrics: latency(2),
          },
          {
            nodeId: CACHE,
            block: "get_cached",
            title: "Caché: miss",
            description: "No hay entrada product:42 (expiró hace 12 s).",
            input: { key: "product:42" },
            output: "miss",
            metrics: latency(0.8, { hit: 0 }),
          },
          {
            nodeId: REPO,
            block: "find_by_id",
            title: "Postgres responde",
            description: "Consulta por clave primaria con índice.",
            input: { sql: "SELECT * FROM products WHERE id = $1", params: [42] },
            output: { id: 42, name: "Teclado", basePrice: 49.9 },
            metrics: latency(18, { rows: 1 }),
          },
          {
            nodeId: PRICING,
            block: "quote",
            title: "Precio dinámico",
            description: "El servicio externo es el paso más lento: candidato a caché o a llamada asíncrona.",
            input: { productId: 42, basePrice: 49.9 },
            output: { price: 44.9, discount: "10 %" },
            metrics: latency(1240, { httpStatus: 200 }),
            durationMs: 2400,
          },
        ]),
      },
    ],
  },
  trace: {
    profile: "http",
    entryNodeId: ROUTES,
    payload: JSON.stringify({ name: "Teclado", basePrice: 49.9 }, null, 2),
  },
};
