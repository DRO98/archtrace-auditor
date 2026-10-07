<div align="center">

# 🧭 ArchTrace

**Entiende cualquier codebase de un vistazo.**
Un tutor visual de arquitectura para tu segunda pantalla, sincronizado en tiempo real con tu IDE.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React Flow](https://img.shields.io/badge/React_Flow-12-ff0072)
![VS Code](https://img.shields.io/badge/VS_Code-extension-007ACC?logo=visualstudiocode)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![BYOK](https://img.shields.io/badge/AI-BYOK_·_Ollama-8A2BE2)

</div>

---

## 🤔 El problema

Los agentes de IA (Claude, Cursor, Devin…) generan en minutos proyectos de decenas de archivos. El resultado funciona, pero es una **caja negra**: nadie sabe bien cómo se conectan las piezas, el modelo mental se rompe y la deuda técnica crece en silencio.

## 💡 La solución

ArchTrace es un **compañero de doble pantalla**:

| 🖥️ Pantalla 1 — tu IDE | 🧑‍🏫 Pantalla 2 — ArchTrace |
|---|---|
| VS Code / Cursor, limpio, solo para editar código. | Un lienzo interactivo que convierte el código en bloques conceptuales, los explica en lenguaje humano y **controla el IDE**: haces clic en un nodo y el editor salta y resalta las líneas exactas. |

```
 ┌──────────────── IDE (VS Code / Cursor) ────────────────┐
 │  Extensión ArchTrace                                   │
 │   · servidor WebSocket local (ws://127.0.0.1:8080)     │
 │   · navegación + resaltado de líneas                   │
 │   · escáner tree-sitter (TS/JS/Python)                 │
 └───────────────────────────▲────────────────────────────┘
                             │  JSON sobre WebSocket  (<10 ms)
 ┌───────────────────────────▼────────────────────────────┐
 │  Web ArchTrace (Next.js + React Flow)                  │
 │   · lienzo con zoom semántico                          │
 │   · tutor IA BYOK (OpenAI · Anthropic · Gemini · Ollama)│
 └────────────────────────────────────────────────────────┘
```

## ✨ Funcionalidades

- **🔍 Zoom semántico** — Nivel 0: 4–6 bloques de arquitectura. Nivel 1: archivos y flujos de datos. Nivel 2: explicación humana con analogías.
- **🎯 Sincronización con el IDE** — clic en un nodo → el editor abre el archivo y resalta el rango. Y al revés: el lienzo sigue al archivo activo.
- **🧑‍🏫 Teacher Drawer** — lecciones generadas por IA, preguntas de seguimiento, conexiones, impacto (*blast radius*) y código.
- **▶️ Simulación de flujo** — un paquete de datos recorre el grafo paso a paso mientras el IDE salta al código de cada etapa ([docs](docs/SIMULATION.md)).
- **📦 Importa cualquier repo** — pega un repositorio público de GitHub o abre una carpeta local y obtén el mapa.
- **🧮 Diff & historial** — qué ha cambiado, qué afecta y sesiones anteriores.
- **🧪 Playground** y exportación a Mermaid / documentación.
- **🔐 BYOK y Zero-Data Retention** — las claves viven en tu navegador; con Ollama puedes funcionar 100 % en local, sin egress.

## 🗂️ Estructura del monorepo

```
.
├── core/        Tipos compartidos: protocolo WS, grafo, lecciones, simulación
├── extension/   Extensión VS Code: servidor WS, navegador, escáner tree-sitter
├── web/         App Next.js: lienzo, tutor, dashboard, simulación
├── sandbox/     Proyecto RAG en Python de ejemplo para probar el mapa
└── docs/        Protocolo, especificación, simulación y tickets
```

> `extension/` y `web/` **solo** se comunican por el protocolo WebSocket — ver [`docs/WEBSOCKET_PROTOCOL.md`](docs/WEBSOCKET_PROTOCOL.md).

## 🚀 Puesta en marcha

**Requisitos:** Node.js 20+, VS Code o Cursor.

```bash
# 1. Dependencias
npm install --prefix extension
npm install --prefix web

# 2. Extensión (luego F5 en VS Code para lanzar el Extension Host)
cd extension && npm run compile

# 3. Web
cd web
cp .env.example .env   # opcional: claves BYOK u Ollama
npm run dev            # http://localhost:3000
```

### 🐳 Self-hosted con Docker

```bash
cd web
cp .env.example .env
docker compose up -d --build
```

Sin volúmenes, sin telemetría y con los secretos inyectados solo en runtime. Detalles en [`web/README.md`](web/README.md).

## 🤖 Proveedores de IA

ArchTrace sigue el modelo **Bring Your Own Key**: tú pones la clave (o un endpoint de Ollama) y las llamadas salen desde tu máquina.

| Proveedor | Configuración |
|---|---|
| Ollama (local) | `OLLAMA_BASE_URL` |
| OpenAI | clave en el navegador o `OPENAI_API_KEY` |
| Anthropic | clave en el navegador o `ANTHROPIC_API_KEY` |
| Gemini | clave en el navegador o `GEMINI_API_KEY` |
| Groq / DeepSeek | `GROQ_API_KEY` / `DEEPSEEK_API_KEY` |

## 🧪 Tests y comprobaciones

```bash
npm run typecheck        # extensión + web
cd web && npm test       # tests unitarios
cd web && npm run graph:validate && npm run scenarios:validate
```

## 📚 Documentación

- [Especificación original del MVP](docs/SPEC.md)
- [Protocolo WebSocket](docs/WEBSOCKET_PROTOCOL.md)
- [Simulación de flujo](docs/SIMULATION.md)
- [Matriz de repos de prueba (dogfood)](docs/DOGFOOD_REPOS.md)

---

<div align="center">
Hecho para que dejes de programar a ciegas. 🧭
</div>
