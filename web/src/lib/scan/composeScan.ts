import type { CodeModule, ModuleEdge, ModuleRole } from "@core/graph";
import { isYamlMap, parseYaml, type YamlMap, type YamlValue } from "./miniYaml";

/**
 * Infraestructura desde docker-compose: los servicios de imagen (Redpanda, MongoDB, Qdrant, Ollama…) pasan a
 * módulos virtuales `infra:<tech>` con su rol, y los servicios que ejecutan código del repo (`command`,
 * `working_dir`, `Dockerfile`) se enlazan con el archivo que arrancan. De ahí salen aristas deterministas:
 * `depends_on`, hosts citados en `environment` (`http://acceso:8000`, `mongo:27017`) y, en `infraEdgesByTech`,
 * código que usa el cliente de una tecnología → su servicio de infraestructura.
 *
 * Varios servicios de la misma tecnología (spark-master + workers, redpanda + redpanda-init) se funden en un
 * solo módulo: al lienzo le interesa "hay Spark", no cuántos contenedores lo sirven.
 */

export const INFRA_PREFIX = "infra:";
export const INFRA_GROUP = "infra";

export function isInfraModuleId(id: string): boolean {
  return id.startsWith(INFRA_PREFIX);
}

/** `docker-compose.yml`, `docker-compose.prod.yaml`, `compose.yml`… en cualquier carpeta. */
export function isComposePath(path: string): boolean {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  return /^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/.test(name);
}

interface InfraTech {
  tech: string;
  label: string;
  role: ModuleRole;
  /** Se prueba contra el último segmento del nombre de imagen y, si no hay imagen conocida, contra el del servicio. */
  re: RegExp;
  /** Tecnologías de `detectSemantics` cuyo cliente habla con este servicio. */
  clients: readonly string[];
}

/** Orden = prioridad (redpanda antes que el genérico kafka). */
const INFRA_TECHS: readonly InfraTech[] = [
  { tech: "redpanda", label: "Redpanda", role: "broker", re: /redpanda/, clients: ["kafka", "redpanda"] },
  { tech: "kafka", label: "Kafka", role: "broker", re: /kafka|zookeeper/, clients: ["kafka"] },
  { tech: "rabbitmq", label: "RabbitMQ", role: "broker", re: /rabbitmq/, clients: ["rabbitmq"] },
  { tech: "nats", label: "NATS", role: "broker", re: /^nats/, clients: ["nats"] },
  { tech: "pulsar", label: "Pulsar", role: "broker", re: /pulsar/, clients: ["pulsar"] },
  { tech: "spark", label: "Spark", role: "stream", re: /spark/, clients: ["spark"] },
  { tech: "flink", label: "Flink", role: "stream", re: /flink/, clients: ["flink"] },
  { tech: "airflow", label: "Airflow", role: "pipeline", re: /airflow/, clients: ["airflow"] },
  { tech: "mongodb", label: "MongoDB", role: "database", re: /^mongo(db)?$|mongodb/, clients: ["mongodb"] },
  { tech: "postgres", label: "PostgreSQL", role: "database", re: /postgres|postgis|timescale/, clients: ["postgres"] },
  { tech: "mysql", label: "MySQL", role: "database", re: /mysql|mariadb/, clients: ["mysql"] },
  { tech: "clickhouse", label: "ClickHouse", role: "database", re: /clickhouse/, clients: ["clickhouse"] },
  { tech: "elasticsearch", label: "Elasticsearch", role: "database", re: /elasticsearch|opensearch/, clients: ["elasticsearch"] },
  { tech: "qdrant", label: "Qdrant", role: "database", re: /qdrant/, clients: ["qdrant"] },
  { tech: "weaviate", label: "Weaviate", role: "database", re: /weaviate/, clients: ["weaviate"] },
  { tech: "milvus", label: "Milvus", role: "database", re: /milvus/, clients: ["milvus"] },
  { tech: "chroma", label: "Chroma", role: "database", re: /chroma/, clients: ["chroma"] },
  { tech: "seaweedfs", label: "SeaweedFS · S3", role: "database", re: /seaweedfs/, clients: ["s3"] },
  { tech: "minio", label: "MinIO · S3", role: "database", re: /minio/, clients: ["s3"] },
  { tech: "s3", label: "S3", role: "database", re: /^s3$|localstack/, clients: ["s3"] },
  { tech: "redis", label: "Redis", role: "cache", re: /redis|valkey|keydb/, clients: ["redis"] },
  { tech: "memcached", label: "Memcached", role: "cache", re: /memcached/, clients: ["memcached"] },
  { tech: "ollama", label: "Ollama", role: "ai-model", re: /ollama/, clients: ["ollama"] },
  { tech: "prometheus", label: "Prometheus", role: "util", re: /prometheus/, clients: ["prometheus"] },
  { tech: "grafana", label: "Grafana", role: "util", re: /grafana/, clients: ["grafana"] },
  { tech: "loki", label: "Loki", role: "util", re: /loki/, clients: [] },
  { tech: "jaeger", label: "Jaeger", role: "util", re: /jaeger|otel-collector|opentelemetry-collector/, clients: [] },
  { tech: "nginx", label: "Gateway (nginx)", role: "api", re: /nginx|traefik|caddy|envoy/, clients: [] },
];

export interface ComposeService {
  name: string;
  image?: string;
  dockerfile?: string;
  buildContext?: string;
  command: string;
  workingDir?: string;
  dependsOn: string[];
  /** Dependencias que solo deben terminar (`service_completed_successfully`): trabajos de arranque, no servicios. */
  oneShot: string[];
  /** Otros servicios citados por host en `environment` (`http://acceso:8000`). */
  envRefs: string[];
  /** Líneas del servicio en el compose (para el enlace al editor). */
  lines?: { start: number; end: number };
}

function text(value: YamlValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  return Object.values(value).map(text).join(" ");
}

function keysOrItems(value: YamlValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(text).filter((item) => item.length > 0);
  if (isYamlMap(value)) return Object.keys(value);
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

/** Valores de `environment` en forma de mapa (`K: v`) o de lista (`- K=v`). */
function envValues(value: YamlValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item).replace(/^[^=]*=/, ""));
  if (isYamlMap(value)) return Object.values(value).map(text);
  return [];
}

/** Hosts de otros servicios citados en una cadena: `//host`, `@host:puerto`, `host:puerto`. */
function hostsIn(value: string, services: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/(?:^|[\s/@,=;"'])([a-z0-9][a-z0-9_.-]*)(?=:\d|[/"']|$)/gi)) {
    const host = match[1];
    if (host && services.has(host)) found.add(host);
  }
  return [...found];
}

export function parseCompose(source: string): ComposeService[] {
  const { value, keyLines } = parseYaml(source);
  if (!isYamlMap(value) || !isYamlMap(value.services)) return [];
  const raw = value.services;
  const names = new Set(Object.keys(raw));
  return Object.entries(raw).map(([name, body]): ComposeService => {
    const spec: YamlMap = isYamlMap(body) ? body : {};
    const build = spec.build;
    const service: ComposeService = {
      name,
      command: [text(spec.entrypoint), text(spec.command)].filter((part) => part.length > 0).join(" "),
      dependsOn: keysOrItems(spec.depends_on).filter((item) => names.has(item) && item !== name),
      oneShot: isYamlMap(spec.depends_on)
        ? Object.entries(spec.depends_on)
            .filter(([, rule]) => isYamlMap(rule) && rule.condition === "service_completed_successfully")
            .map(([item]) => item)
        : [],
      envRefs: [...new Set(envValues(spec.environment).flatMap((item) => hostsIn(item, names)))].filter((item) => item !== name).sort(),
    };
    if (typeof spec.image === "string") service.image = spec.image;
    if (typeof build === "string") service.buildContext = build;
    else if (isYamlMap(build)) {
      if (typeof build.context === "string") service.buildContext = build.context;
      if (typeof build.dockerfile === "string") service.dockerfile = build.dockerfile;
    }
    if (typeof spec.working_dir === "string") service.workingDir = spec.working_dir;
    const lines = keyLines.get(`services.${name}`);
    if (lines) service.lines = lines;
    return service;
  });
}

/** `docker.io/bitnami/mongodb:8.0` → `mongodb`. */
function imageName(image: string): string {
  const withoutTag = image.replace(/@.*$/, "").replace(/:[^/]*$/, "");
  return (withoutTag.split("/").pop() ?? withoutTag).toLowerCase();
}

/** Tecnología de un servicio: primero por imagen (repositorio completo), luego por el primer token del nombre. */
export function classifyService(service: Pick<ComposeService, "name" | "image">): InfraTech | null {
  if (service.image) {
    const name = imageName(service.image);
    const repo = service.image.toLowerCase().replace(/:[^/]*$/, "");
    const byImage = INFRA_TECHS.find((item) => item.re.test(name)) ?? INFRA_TECHS.find((item) => item.re.test(repo));
    if (byImage) return byImage;
  }
  const token = service.name.toLowerCase().split(/[-_.]/)[0] ?? "";
  return INFRA_TECHS.find((item) => item.re.test(token) || item.re.test(service.name.toLowerCase())) ?? null;
}

function joinPath(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const segment of part.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
  }
  return segments.join("/");
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

const ENTRY_STEMS = ["main", "app", "server", "index", "__main__", "cli"];
const ENTRY_EXTS = [".py", ".ts", ".js", ".mjs", ".go"];

/**
 * Archivo del repo que arranca un servicio con `build`. Por orden: módulo Python en `command`
 * (`uvicorn a.b:app`, `python -m a.b`), script relativo al `working_dir` (`chainlit run app.py`) y, si no,
 * el entrypoint junto al `Dockerfile` o en el contexto de build. null si nada encaja con un archivo conocido.
 */
export function serviceEntryFile(
  service: ComposeService,
  composeDir: string,
  known: ReadonlySet<string>,
  options: { useBuild?: boolean } = {},
): string | null {
  const within = (path: string): string | null => (known.has(path) ? path : null);
  const tokens = service.command.split(/[\s"',[\]]+/).filter((token) => token.length > 0);

  for (const [index, token] of tokens.entries()) {
    const target = /^([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+):[A-Za-z_]\w*$/.exec(token)?.[1] ?? (tokens[index - 1] === "-m" ? token : null);
    if (!target || !/^[A-Za-z_][\w.]*$/.test(target)) continue;
    const base = joinPath(composeDir, target.replace(/\./g, "/"));
    const hit = within(`${base}.py`) ?? within(`${base}/__main__.py`) ?? within(`${base}/__init__.py`);
    if (hit) return hit;
  }

  const scripts = tokens.filter((token) => /\.(py|m?js|ts)$/.test(token) && !token.startsWith("-"));
  if (scripts.length > 0) {
    const workSegments = (service.workingDir ?? "").split("/").filter((segment) => segment.length > 0);
    const bases = [
      ...workSegments.map((_, index) => workSegments.slice(index).join("/")),
      service.buildContext ?? "",
      "",
    ];
    for (const script of scripts) {
      for (const base of bases) {
        const hit = within(joinPath(composeDir, base, script));
        if (hit) return hit;
      }
    }
  }

  if (options.useBuild === false) return null;
  const dirs: string[] = [];
  if (service.dockerfile) dirs.push(dirOf(joinPath(composeDir, service.buildContext ?? ".", service.dockerfile)));
  if (service.buildContext && joinPath(service.buildContext) !== "") dirs.push(joinPath(composeDir, service.buildContext));
  for (const dir of dirs) {
    if (dir === "" || dir === joinPath(composeDir)) continue;
    for (const stem of ENTRY_STEMS) {
      for (const ext of ENTRY_EXTS) {
        const hit = within(joinPath(dir, `${stem}${ext}`)) ?? within(joinPath(dir, "src", `${stem}${ext}`));
        if (hit) return hit;
      }
    }
  }
  return null;
}

export interface ComposeScan {
  /** Módulos `infra:<tech>`, uno por tecnología. */
  modules: CodeModule[];
  /** Aristas servicio → servicio (`depends_on` y hosts en `environment`), ya traducidas a ids de módulo. */
  edges: ModuleEdge[];
  /** Tecnología de infraestructura → módulo, para enlazar después el código que usa su cliente. */
  clientsOf: ReadonlyMap<string, string[]>;
  /** Archivo de código → servicio del compose que lo arranca (el primero, si varios comparten archivo). */
  serviceOf: ReadonlyMap<string, string>;
}

const DATA_ROLES: ReadonlySet<ModuleRole> = new Set(["broker", "stream", "database", "cache"]);

/**
 * Módulos de infraestructura y aristas de uno o varios compose. `known` son los archivos de código del grafo:
 * un servicio que arranca uno de ellos se representa con ese módulo, no con uno virtual.
 */
export function scanCompose(files: ReadonlyMap<string, string>, known: ReadonlySet<string>): ComposeScan {
  const modules = new Map<string, CodeModule>();
  const roleOf = new Map<string, ModuleRole>();
  const labelOf = new Map<string, string>();
  const clientsOf = new Map<string, string[]>();
  const serviceOf = new Map<string, string>();
  const pending: Array<{ from: string; to: string; via: "depends_on" | "env" }> = [];

  // `docker-compose.yml` antes que sus variantes (`docker-compose.sin-gpu.yml`): da el archivo de cada módulo.
  const ordered = [...files].sort(([left], [right]) => left.split("/").length - right.split("/").length || left.length - right.length || left.localeCompare(right));
  for (const [composePath, source] of ordered) {
    const services = parseCompose(source);
    const composeDir = dirOf(composePath);
    const nodeOf = new Map<string, string>();
    for (const service of services) {
      const entry = serviceEntryFile(service, composeDir, known, { useBuild: false });
      if (entry) {
        nodeOf.set(service.name, entry);
        if (!serviceOf.has(entry)) serviceOf.set(entry, service.name);
        continue;
      }
      const tech = classifyService(service);
      if (tech) {
        const id = `${INFRA_PREFIX}${tech.tech}`;
        nodeOf.set(service.name, id);
        roleOf.set(id, tech.role);
        labelOf.set(id, tech.label);
        for (const client of tech.clients) clientsOf.set(client, [...new Set([...(clientsOf.get(client) ?? []), id])]);
        const existing = modules.get(id);
        const block = service.lines
          ? [{ id: `${id}::${service.name}`, kind: "block" as const, name: service.name, range: { startLine: service.lines.start, endLine: service.lines.end } }]
          : [];
        if (existing) {
          // Las líneas solo valen para el archivo al que apunta el módulo (el primer compose que declaró la tecnología).
          if (existing.filePath === composePath) existing.subBlocks.push(...block.filter((item) => !existing.subBlocks.some((known) => known.id === item.id)));
          continue;
        }
        modules.set(id, {
          id,
          label: tech.label,
          filePath: composePath,
          groupId: INFRA_GROUP,
          language: "yaml",
          role: tech.role,
          tech: [tech.tech],
          summary: `Servicio de infraestructura (${tech.label}) declarado en ${composePath}`,
          subBlocks: block,
        });
        continue;
      }
      const built = serviceEntryFile(service, composeDir, known);
      if (built) {
        nodeOf.set(service.name, built);
        if (!serviceOf.has(built)) serviceOf.set(built, service.name);
      }
    }
    for (const service of services) {
      const from = nodeOf.get(service.name);
      if (!from) continue;
      // Primero los hosts de `environment`: si también hay `depends_on`, la arista se etiqueta por el protocolo.
      for (const target of service.envRefs) {
        const to = nodeOf.get(target);
        if (to) pending.push({ from, to, via: "env" });
      }
      for (const target of service.dependsOn) {
        const to = nodeOf.get(target);
        // Esperar a que un trabajo de arranque del repo termine (`s3-init`) no es una dependencia de arquitectura.
        if (!to || (service.oneShot.includes(target) && !isInfraModuleId(to))) continue;
        pending.push({ from, to, via: "depends_on" });
      }
    }
  }

  for (const item of modules.values()) item.subtitle = item.subBlocks.map((block) => block.name).slice(0, 3).join(" · ");

  const edges = new Map<string, ModuleEdge>();
  for (const { from, to, via } of pending) {
    if (from === to) continue;
    const targetRole = roleOf.get(to);
    const kind: ModuleEdge["kind"] = targetRole && DATA_ROLES.has(targetRole) ? "data-flow" : "calls";
    const id = `${kind}:${from}:${to}`;
    if (edges.has(id)) continue;
    const label = labelOf.get(to) ?? (via === "env" ? "HTTP" : "depends_on");
    edges.set(id, { id, source: from, target: to, kind, label });
  }
  return {
    modules: [...modules.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
    clientsOf,
    serviceOf,
  };
}

/**
 * Código que usa el cliente de una tecnología → su servicio de infraestructura (`pymongo` → `infra:mongodb`).
 * Solo con evidencia en ambos extremos: el módulo detectó la tecnología y el compose la declara.
 */
export function infraEdgesByTech(
  techByModule: ReadonlyMap<string, readonly string[]>,
  scan: Pick<ComposeScan, "clientsOf" | "modules">,
): ModuleEdge[] {
  const labels = new Map(scan.modules.map((item) => [item.id, item.label]));
  const roles = new Map(scan.modules.map((item) => [item.id, item.role]));
  const edges = new Map<string, ModuleEdge>();
  for (const [moduleId, techs] of techByModule) {
    for (const tech of techs) {
      for (const target of scan.clientsOf.get(tech) ?? []) {
        const role = roles.get(target);
        const kind: ModuleEdge["kind"] = role && DATA_ROLES.has(role) ? "data-flow" : "calls";
        const id = `${kind}:${moduleId}:${target}`;
        if (!edges.has(id)) edges.set(id, { id, source: moduleId, target, kind, label: labels.get(target) ?? tech });
      }
    }
  }
  return [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
}
