import type { SimpleIcon } from "simple-icons";
import {
  siAnthropic,
  siApacheairflow,
  siApacheflink,
  siApachekafka,
  siApachepulsar,
  siApachespark,
  siClickhouse,
  siDocker,
  siElasticsearch,
  siFastapi,
  siGrafana,
  siJaeger,
  siKeras,
  siLangchain,
  siMariadb,
  siMediapipe,
  siMinio,
  siMongodb,
  siMysql,
  siNatsdotio,
  siNginx,
  siOllama,
  siOpensearch,
  siPostgresql,
  siPrometheus,
  siPytorch,
  siQdrant,
  siRabbitmq,
  siRedis,
  siSqlite,
  siTensorflow,
  siTraefikproxy,
} from "simple-icons";
import { LOCAL_PATHS } from "./providerLogos";

/**
 * Logo oficial de cada tecnología del stack (ids de `detectSemantics` y de `composeScan`): de simple-icons, de las
 * rutas de marca que ya usa el proyecto o, si simple-icons no la publica, el SVG oficial del repositorio de la propia
 * marca en `public/stack/` (Redpanda: redpanda-data/redpanda `docs/icon-redpanda.svg`; SeaweedFS:
 * seaweedfs/seaweedfs `note/seaweedfs.svg`; Chainlit: Chainlit/chainlit `frontend/public/favicon.svg`).
 * Lo que no tiene logo oficial no se inventa: el nodo cae al icono de su rol.
 */
export type StackGlyph = Pick<SimpleIcon, "path" | "hex" | "title">;
export type StackLogo = ({ kind: "glyph" } & StackGlyph) | { kind: "file"; src: string; title: string };

const glyph = (icon: SimpleIcon): StackGlyph => ({ path: icon.path, hex: icon.hex, title: icon.title });

const STACK_GLYPHS: Readonly<Record<string, StackGlyph>> = {
  kafka: glyph(siApachekafka),
  rabbitmq: glyph(siRabbitmq),
  pulsar: glyph(siApachepulsar),
  nats: glyph(siNatsdotio),
  spark: glyph(siApachespark),
  flink: glyph(siApacheflink),
  airflow: glyph(siApacheairflow),
  mongodb: glyph(siMongodb),
  postgres: glyph(siPostgresql),
  mysql: glyph(siMysql),
  mariadb: glyph(siMariadb),
  clickhouse: glyph(siClickhouse),
  sqlite: glyph(siSqlite),
  elasticsearch: glyph(siElasticsearch),
  opensearch: glyph(siOpensearch),
  qdrant: glyph(siQdrant),
  minio: glyph(siMinio),
  redis: glyph(siRedis),
  ollama: glyph(siOllama),
  langchain: glyph(siLangchain),
  openai: { path: LOCAL_PATHS.openai, hex: "412991", title: "OpenAI" },
  anthropic: glyph(siAnthropic),
  mediapipe: glyph(siMediapipe),
  keras: glyph(siKeras),
  tensorflow: glyph(siTensorflow),
  pytorch: glyph(siPytorch),
  prometheus: glyph(siPrometheus),
  grafana: glyph(siGrafana),
  jaeger: glyph(siJaeger),
  fastapi: glyph(siFastapi),
  nginx: glyph(siNginx),
  traefik: glyph(siTraefikproxy),
  docker: glyph(siDocker),
};

/** SVG oficiales servidos desde `public/stack/` (marcas que simple-icons no publica). */
const STACK_FILES: Readonly<Record<string, { src: string; title: string }>> = {
  redpanda: { src: "/stack/redpanda.svg", title: "Redpanda" },
  seaweedfs: { src: "/stack/seaweedfs.svg", title: "SeaweedFS" },
  chainlit: { src: "/stack/chainlit.svg", title: "Chainlit" },
};

/** Sinónimos que aparecen en etiquetas y nombres de servicio («Apache Spark», «mongo», «postgresql»…). */
const ALIASES: Readonly<Record<string, string>> = {
  mongo: "mongodb",
  postgresql: "postgres",
  apache: "",
  s3: "",
  sparkstreaming: "spark",
  kafkajs: "kafka",
  helm: "",
};

export function stackLogo(tech: string | undefined): StackLogo | null {
  if (!tech) return null;
  const found = STACK_GLYPHS[tech];
  if (found) return { kind: "glyph", ...found };
  const file = STACK_FILES[tech];
  return file ? { kind: "file", ...file } : null;
}

/** La primera tecnología de la lista con logo oficial, o null. */
export function firstStackLogo(techs: readonly string[]): { tech: string; logo: StackLogo } | null {
  for (const tech of techs) {
    const logo = stackLogo(tech);
    if (logo) return { tech, logo };
  }
  return null;
}

/**
 * Logo de un nodo de Level 0. La infra usa su propia tecnología (id `infra:<tech>` o, en grafos antiguos sin `tech`,
 * las palabras de su nombre: «SeaweedFS · S3» → seaweedfs); un servicio, su primera tecnología con logo.
 */
export function blockLogo(block: { kind: string; techIds: readonly string[]; primaryModuleId?: string; label: string }): StackLogo | null {
  const fromLabel = block.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => ALIASES[word] ?? word)
    .filter((word) => word.length > 0);
  if (block.kind === "infra") {
    const own = block.primaryModuleId?.startsWith("infra:") ? block.primaryModuleId.slice("infra:".length) : undefined;
    return firstStackLogo([...(block.techIds[0] ? [block.techIds[0]] : []), ...(own ? [own] : []), ...fromLabel])?.logo ?? null;
  }
  return firstStackLogo([...block.techIds, ...fromLabel])?.logo ?? null;
}

/** Marcas casi blancas (o negras sobre negro) no se leen sobre el tile: se pintan en tinta. */
export function readableHex(hex: string): string {
  const value = Number.parseInt(hex, 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.85 ? "171717" : hex;
}
