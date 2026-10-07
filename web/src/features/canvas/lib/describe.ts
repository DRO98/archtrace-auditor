import type { CodeModule, CodeSubBlock, EdgeKind, ModuleRole } from "@core/graph";

/** Frases en español para la interfaz: nunca muestran nombres crudos de funciones o ficheros. */

function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0);
}

function hasAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

/** Texto ya legible: varias palabras, sin guiones bajos, puntos medios, paréntesis ni camelCase. */
export function isHumanText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length < 2) return false;
  return !/[_·()/\\]|[a-z][A-Z]|\.\w/.test(trimmed);
}

const MODULE_RULES: ReadonlyArray<{ when: readonly string[]; text: string }> = [
  { when: ["config", "settings", "env"], text: "Configuración del sistema" },
  { when: ["bootstrap", "main"], text: "Inicialización del sistema" },
  { when: ["vector", "vectors", "faiss", "chroma", "pinecone"], text: "Búsqueda por similitud vectorial" },
  { when: ["embed", "embedding", "embeddings", "embedder"], text: "Convierte texto en vectores" },
  { when: ["chunk", "chunker", "splitter", "split"], text: "Troceado de textos" },
  { when: ["prompt", "prompts", "template", "templates"], text: "Plantillas de instrucciones para IA" },
  { when: ["llm", "openai", "anthropic", "gemini", "ollama", "completion"], text: "Generación de respuestas con IA" },
  { when: ["rag"], text: "Orquestación del flujo RAG" },
  { when: ["pipeline", "workflow", "orchestrator", "chain"], text: "Orquestación de pasos" },
  { when: ["route", "routes", "router", "endpoint", "endpoints", "controller", "controllers", "api"], text: "Entrada de peticiones HTTP" },
  { when: ["auth", "login", "session", "token"], text: "Control de acceso" },
  { when: ["cache"], text: "Caché de resultados" },
  { when: ["database", "db", "repository", "repo", "sql", "storage"], text: "Guardado y lectura de datos" },
  { when: ["parser", "parse", "format", "formatter"], text: "Lectura e interpretación de datos" },
];

const ROLE_FALLBACK: Record<ModuleRole, string> = {
  api: "Entrada de peticiones HTTP",
  pipeline: "Orquestación de pasos",
  database: "Guardado y lectura de datos",
  cache: "Caché de acceso rápido",
  broker: "Cola o topic de mensajes",
  stream: "Procesado continuo de eventos",
  rpc: "Llamadas remotas entre servicios",
  "ai-model": "Servicio de inteligencia artificial",
  transform: "Preparación de datos",
  prompt: "Plantillas de instrucciones para IA",
  app: "Inicialización del sistema",
  service: "Lógica de negocio",
  ui: "Interfaz de usuario",
  util: "Funciones de apoyo",
  code: "Lógica del módulo",
};

/** Subtítulo de 3-5 palabras para la tarjeta y la cabecera del panel. */
export function describeModule(module: CodeModule, role: ModuleRole): string {
  if (module.summary && isHumanText(module.summary) && module.summary.split(/\s+/).length <= 6) {
    return module.summary;
  }
  if (module.subtitle && isHumanText(module.subtitle)) return module.subtitle;
  const tokens = new Set([...words(module.filePath), ...words(module.label)]);
  for (const rule of MODULE_RULES) {
    if (hasAny(tokens, rule.when)) return rule.text;
  }
  return ROLE_FALLBACK[role];
}

const VERBS: Record<string, string> = {
  get: "Obtiene",
  fetch: "Descarga",
  load: "Carga",
  read: "Lee",
  save: "Guarda",
  write: "Escribe",
  store: "Guarda",
  insert: "Inserta",
  add: "Añade",
  upsert: "Inserta o actualiza",
  update: "Actualiza",
  set: "Asigna",
  delete: "Elimina",
  remove: "Elimina",
  list: "Enumera",
  search: "Busca",
  find: "Busca",
  query: "Consulta",
  build: "Construye",
  create: "Crea",
  make: "Crea",
  init: "Inicializa",
  setup: "Prepara",
  start: "Arranca",
  run: "Ejecuta",
  main: "Arranca",
  handle: "Gestiona",
  process: "Procesa",
  ask: "Atiende",
  answer: "Responde",
  ingest: "Incorpora",
  retrieve: "Recupera",
  chunk: "Trocea",
  split: "Divide",
  embed: "Convierte en vectores",
  complete: "Genera una respuesta para",
  generate: "Genera",
  stream: "Emite poco a poco",
  send: "Envía",
  parse: "Interpreta",
  format: "Da formato a",
  render: "Dibuja",
  validate: "Valida",
  check: "Comprueba",
  require: "Exige",
  normalize: "Normaliza",
  clean: "Limpia",
  clip: "Recorta",
  collapse: "Compacta",
  slug: "Genera un identificador legible para",
  count: "Cuenta",
  compute: "Calcula",
  calculate: "Calcula",
  cosine: "Calcula la similitud del coseno entre",
  convert: "Convierte",
  to: "Convierte a",
  is: "Comprueba si es",
  has: "Comprueba si tiene",
};

/** Complemento por defecto cuando el nombre solo tiene verbo ("load", "search"). */
const ALONE: Record<string, string> = {
  load: "Carga los datos guardados",
  save: "Guarda los cambios",
  store: "Guarda los datos",
  insert: "Inserta un elemento nuevo",
  add: "Añade un elemento nuevo",
  upsert: "Inserta o actualiza un elemento",
  update: "Actualiza un elemento existente",
  delete: "Elimina un elemento",
  remove: "Elimina un elemento",
  get: "Obtiene un elemento concreto",
  fetch: "Descarga los datos",
  list: "Enumera todos los elementos",
  search: "Busca los elementos más parecidos",
  find: "Busca un elemento",
  query: "Consulta los datos",
  ingest: "Incorpora contenido nuevo",
  retrieve: "Recupera la información relevante",
  answer: "Responde a la pregunta",
  normalize: "Normaliza los valores",
  embed: "Convierte texto en vectores",
  complete: "Genera una respuesta con el modelo",
  generate: "Genera el resultado",
  collapse: "Compacta los espacios del texto",
  clip: "Recorta el texto",
  slug: "Genera un identificador legible",
  run: "Ejecuta el proceso",
  start: "Arranca el proceso",
  init: "Inicializa el estado",
  setup: "Prepara el entorno",
  handle: "Gestiona el evento",
  process: "Procesa los datos",
  validate: "Valida los datos",
  parse: "Interpreta la entrada",
  render: "Dibuja la vista",
  send: "Envía el mensaje",
  build: "Construye el objeto",
  create: "Crea un elemento",
};

const PLURAL: Record<string, string> = {
  chunk: "fragmentos",
  note: "notas",
  token: "tokens",
  document: "documentos",
  doc: "documentos",
  item: "elementos",
  record: "registros",
  vector: "vectores",
  word: "palabras",
  line: "líneas",
  user: "usuarios",
};

const NOUNS: Record<string, string> = {
  question: "la pregunta del usuario",
  document: "un documento",
  documents: "documentos",
  doc: "un documento",
  note: "una nota",
  notes: "las notas",
  prompt: "el prompt",
  text: "el texto",
  texts: "los textos",
  tokens: "los tokens",
  token: "un token",
  pipeline: "el pipeline",
  many: "varios elementos a la vez",
  all: "todos los elementos",
  length: "la longitud",
  width: "el tamaño del vector",
  similarity: "dos vectores",
  vector: "un vector",
  vectors: "vectores",
  record: "un registro",
  records: "registros",
  user: "el usuario",
  users: "los usuarios",
  data: "los datos",
  file: "un fichero",
  files: "ficheros",
  config: "la configuración",
  settings: "la configuración",
  response: "la respuesta",
  request: "la petición",
  context: "el contexto",
  query: "la consulta",
  chunks: "los fragmentos",
  chunk: "un fragmento",
};

const DUNDER: Record<string, string> = {
  __init__: "Prepara el estado inicial del objeto",
  __len__: "Devuelve cuántos elementos contiene",
  __str__: "Genera su representación en texto",
  __repr__: "Genera su representación para depurar",
  __iter__: "Permite recorrer sus elementos",
  __eq__: "Compara dos objetos",
  __call__: "Permite usar el objeto como función",
  __enter__: "Abre el contexto de uso",
  __exit__: "Cierra el contexto de uso",
  constructor: "Prepara el estado inicial del objeto",
};

function simpleName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

function humanizeIdentifier(name: string): string {
  return words(name)
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Frase corta que explica qué hace un método, función o clase. */
export function describeSubBlock(block: CodeSubBlock, siblings: readonly CodeSubBlock[] = []): string {
  if (block.summary && block.summary.trim().length > 0) return block.summary;
  const name = simpleName(block.name);
  const internal = name.startsWith("_") && !(name.startsWith("__") && name.endsWith("__"));

  if (block.kind === "class") {
    const methods = siblings.filter((item) => item.parentId === block.id).length;
    const subject = humanizeIdentifier(name);
    return methods > 0
      ? `Agrupa los datos y las operaciones de «${subject}»`
      : `Estructura de datos que describe «${subject}»`;
  }
  if (block.kind === "block") return "Fragmento de código de nivel superior";

  const dunder = DUNDER[name];
  if (dunder) return dunder;

  const parts = words(name);
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1);
  if (last === "count" && head.length > 0) {
    const sentence = `Calcula cuántos ${PLURAL[head[head.length - 1] ?? ""] ?? "elementos"} hay`;
    return internal ? `${sentence} (uso interno)` : sentence;
  }
  if ((last === "length" || last === "size") && head.length > 0) {
    const noun = head.map((part) => NOUNS[part] ?? part).join(" ");
    const sentence = `Mide la longitud de ${noun}`.replace(/\bde el\b/g, "del");
    return internal ? `${sentence} (uso interno)` : sentence;
  }
  const verbIndex = parts.findIndex((part) => VERBS[part] !== undefined);
  let sentence: string;
  if (verbIndex === -1) {
    sentence = `Se encarga de «${humanizeIdentifier(name)}»`;
  } else {
    const verb = VERBS[parts[verbIndex] ?? ""] ?? "";
    const rest = parts.filter((_, index) => index !== verbIndex);
    const objects = rest.map((part) => NOUNS[part] ?? part);
    const key = parts[verbIndex] ?? "";
    sentence = objects.length > 0 ? `${verb} ${objects.join(" ")}` : (ALONE[key] ?? verb);
    if (parts[verbIndex] === "main") sentence = "Punto de arranque del programa";
  }
  return internal ? `${sentence} (uso interno)` : sentence;
}

const SENDS: Record<ModuleRole, string> = {
  api: "recibe la petición HTTP del usuario",
  pipeline: "coordina los pasos del flujo",
  database: "gestiona los datos guardados",
  cache: "consulta o guarda en caché",
  broker: "publica o consume mensajes",
  stream: "procesa el flujo de eventos",
  rpc: "hace una llamada remota",
  "ai-model": "prepara una llamada al modelo de IA",
  transform: "prepara los datos",
  prompt: "compone las instrucciones",
  app: "arranca la aplicación",
  service: "ejecuta la lógica de negocio",
  ui: "reacciona a lo que hace el usuario",
  util: "necesita una operación auxiliar",
  code: "necesita parte de su lógica",
};

const PURPOSE: Record<ModuleRole, string> = {
  api: "exponer la funcionalidad como endpoint",
  pipeline: "orquestar la respuesta paso a paso",
  database: "guardar y consultar datos",
  cache: "acelerar lecturas repetidas",
  broker: "desacoplar productores y consumidores",
  stream: "transformar eventos en tiempo real",
  rpc: "comunicar servicios con un contrato tipado",
  "ai-model": "generar texto o vectores con IA",
  transform: "trocear y limpiar el texto",
  prompt: "construir las instrucciones del modelo",
  app: "arrancar la aplicación",
  service: "resolver la lógica de negocio",
  ui: "mostrar el resultado en pantalla",
  util: "reutilizar funciones de apoyo",
  code: "reutilizar su lógica",
};

const KIND_NOTE: Record<EdgeKind, string> = {
  imports: "Lo hace importando su código.",
  calls: "Lo hace llamando directamente a sus funciones.",
  "data-flow": "Los datos pasan de uno a otro.",
};

export interface ConnectionEnd {
  label: string;
  role: ModuleRole;
}

/** Explicación sencilla de por qué `from` se conecta con `to`. */
export function describeConnection(
  from: ConnectionEnd,
  to: ConnectionEnd,
  options: { kind?: EdgeKind; support?: boolean; label?: string } = {},
): string {
  const verb = options.support ? "se apoya en" : "envía el trabajo a";
  const main =
    from.role === "app"
      ? `Al arrancar, ${from.label} crea y configura ${to.label}, que se encargará de ${PURPOSE[to.role]}.`
      : `${from.label} ${SENDS[from.role]} y ${verb} ${to.label} para ${PURPOSE[to.role]}.`;
  const extra = options.label && isHumanText(options.label) ? ` ${options.label}.` : "";
  const note = options.kind ? ` ${KIND_NOTE[options.kind]}` : "";
  return `${main}${extra}${note}`;
}
