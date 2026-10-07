<div align="center">

# ArchTrace Auditor

**Revisa lo que ha cambiado un agente de IA antes de aceptarlo.**
Un auditor independiente de cambios: reglas deterministas, las reglas de tu propio repo y un LLM BYOK validado, con revisión en diff y un `Auditoria.md` trazable.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![tree-sitter](https://img.shields.io/badge/tree--sitter-Python_·_TS-2E7D32)
![Qdrant](https://img.shields.io/badge/RAG-BM25_·_Qdrant-DC244C)
![BYOK](https://img.shields.io/badge/AI-BYOK_·_Ollama-8A2BE2)

</div>

---

## El problema

Los agentes de IA (Claude, Cursor, Devin…) cambian decenas de archivos en minutos. Revisar ese diff a mano es lento y fácil de hacer mal: un `has_perm` quitado, un filtro por tenant olvidado o un importe convertido con `int()` se pierden entre cientos de líneas de cambios inocuos.

## Qué hace

1. **Lee el diff de git** (último commit, rango, rama o cambios sin commitear) y lo trocea por función o clase con tree-sitter.
2. **Aplica reglas deterministas**: 18 categorías (autorización, multi-tenant, pagos, SQL, migraciones, secretos…), ampliables con `.archtrace/taxonomy.json`.
3. **Lee las reglas de tu repo** (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `docs/`) y eleva la criticidad cuando un cambio toca algo que tu equipo marcó como crítico.
4. **Consulta un LLM con tu clave** (opcional) con contexto progresivo y las reglas pertinentes (RAG: BM25 o híbrido con Qdrant). Valida su respuesta: descarta evidencias que no están en el diff y reglas inexistentes, y nunca le deja bajar la criticidad de una señal fuerte.
5. **Genera `Auditoria.md`** y una UI de revisión con diff (Monaco) y resaltado por criticidad, donde aceptas, rechazas o marcas falsos positivos (atajos `j/k/a/r/f/v`). Cada revisión queda guardada.

Sin LLM también funciona: solo con reglas, sin enviar nada fuera de tu máquina.

## Puesta en marcha

**Requisitos:** Node.js 20+ y git.

```bash
# 1. Dependencias (cada paquete tiene su node_modules)
npm run install:all

# 2. Auditor: API local en 127.0.0.1:8090
cd auditor && npm run serve

# 3. Web (otra terminal): http://localhost:3000 → Auditorías
cd web && npm run dev
```

En la web: vincula la ruta de un repo local, elige qué cambios auditar y pulsa **Auditar cambios**. Para el análisis con LLM, pega tu clave en **API & Integración** (viaja en cada petición y el auditor no la guarda) o ponla en `auditor/.env`.

También desde la terminal o en CI:

```bash
cd auditor
npm run audit -- --repo ../mi-repo --mode branch --base main --llm gemini --fail-on critical
```

### RAG vectorial (opcional)

```bash
cd web && docker compose --profile rag up -d qdrant   # Qdrant en 127.0.0.1:6333
ollama pull nomic-embed-text                         # embeddings locales
```

Si están disponibles, el auditor combina BM25 con búsqueda vectorial para encontrar reglas aunque no compartan palabras con el código. Si no, usa BM25. Detalles en [`auditor/README.md`](auditor/README.md).

## Estructura del monorepo

```
.
├── auditor/     Auditor: git, índice, reglas, RAG, LLM, decisión, Auditoria.md, CLI y API HTTP
├── web/         App Next.js: Auditorías (inicio), revisión con Monaco, bóveda BYOK, mapa de arquitectura
├── core/        Tipos compartidos y funciones puras (audit.ts, protocolo WS…)
├── scanner/     Escáner tree-sitter (Python, JS/TS) sin VS Code — `@scanner/*`
├── llm/         Capa LLM BYOK en Node puro (6 proveedores) — `@llm/*`
├── extension/   Extensión VS Code: "Abrir en VS Code" desde la revisión y mapa en vivo
├── sandbox/     Proyecto Python de ejemplo
└── docs/        Protocolo, especificación y tickets
```

> `web/` habla con `auditor/` **solo** por su API HTTP local, y con `extension/` **solo** por WebSocket ([`docs/WEBSOCKET_PROTOCOL.md`](docs/WEBSOCKET_PROTOCOL.md)).

El tutor visual original (mapa de arquitectura, simulación, playground) sigue disponible como **Mapa de arquitectura** en la navegación secundaria.

## Proveedores de IA

Modelo **Bring Your Own Key**: tú pones la clave (o un endpoint de Ollama) y las llamadas salen desde tu máquina. Los archivos sensibles (`.env`, claves…) nunca se envían al LLM y las cadenas con aspecto de secreto se redactan.

| Proveedor | Configuración |
|---|---|
| Ollama (local) | `OLLAMA_BASE_URL` |
| OpenAI | clave en el navegador o `OPENAI_API_KEY` |
| Anthropic | clave en el navegador o `ANTHROPIC_API_KEY` |
| Gemini | clave en el navegador o `GEMINI_API_KEY` |
| Groq / DeepSeek | `GROQ_API_KEY` / `DEEPSEEK_API_KEY` |

### Self-hosted con Docker

```bash
cd web
cp .env.example .env
docker compose up -d --build
```

El auditor corre en el host (necesita leer tus repos y git); el contenedor del web solo sirve la interfaz.

## Tests y comprobaciones

```bash
npm run typecheck        # scanner + llm + auditor + extensión + web
npm test                 # tests unitarios de todos los paquetes
```

## Documentación

- [Auditor: CLI, API, RAG y solución de problemas](auditor/README.md)
- [Plan de arquitectura del auditor](auditor_de_cambios_ia_131276c1.plan.md)
- [Protocolo WebSocket](docs/WEBSOCKET_PROTOCOL.md)
- [Especificación original del MVP](docs/SPEC.md)

---

<div align="center">
Hecho para que no aceptes cambios a ciegas.
</div>
