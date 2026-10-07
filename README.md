<div align="center">

# ArchTrace

**Entiende cualquier codebase de un vistazo.**
Un tutor visual de arquitectura para tu segunda pantalla, sincronizado en tiempo real con tu IDE.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React Flow](https://img.shields.io/badge/React_Flow-12-ff0072)
![VS Code](https://img.shields.io/badge/VS_Code-extension-007ACC?logo=visualstudiocode)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![BYOK](https://img.shields.io/badge/AI-BYOK_·_Ollama-8A2BE2)

</div>

---

## El problema

Los agentes de IA (Claude, Cursor, Devin…) generan en minutos proyectos de decenas de archivos. El resultado funciona, pero es una **caja negra**: nadie sabe bien cómo se conectan las piezas, el modelo mental se rompe y la deuda técnica crece en silencio.


## Estructura del monorepo

```
.
├── core/        Tipos compartidos: protocolo WS, grafo, lecciones, simulación
├── extension/   Extensión VS Code: servidor WS, navegador, escáner tree-sitter
├── web/         App Next.js: lienzo, tutor, dashboard, simulación
├── sandbox/     Proyecto RAG en Python de ejemplo para probar el mapa
└── docs/        Protocolo, especificación, simulación y tickets
```

> `extension/` y `web/` **solo** se comunican por el protocolo WebSocket — ver [`docs/WEBSOCKET_PROTOCOL.md`](docs/WEBSOCKET_PROTOCOL.md).

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

### Self-hosted con Docker

```bash
cd web
cp .env.example .env
docker compose up -d --build
```

Sin volúmenes, sin telemetría y con los secretos inyectados solo en runtime. Detalles en [`web/README.md`](web/README.md).

## Proveedores de IA

ArchTrace sigue el modelo **Bring Your Own Key**: tú pones la clave (o un endpoint de Ollama) y las llamadas salen desde tu máquina.

| Proveedor | Configuración |
|---|---|
| Ollama (local) | `OLLAMA_BASE_URL` |
| OpenAI | clave en el navegador o `OPENAI_API_KEY` |
| Anthropic | clave en el navegador o `ANTHROPIC_API_KEY` |
| Gemini | clave en el navegador o `GEMINI_API_KEY` |
| Groq / DeepSeek | `GROQ_API_KEY` / `DEEPSEEK_API_KEY` |

## Tests y comprobaciones

```bash
npm run typecheck        # extensión + web
cd web && npm test       # tests unitarios
cd web && npm run graph:validate && npm run scenarios:validate
```

## Documentación

- [Especificación original del MVP](docs/SPEC.md)
- [Protocolo WebSocket](docs/WEBSOCKET_PROTOCOL.md)
- [Simulación de flujo](docs/SIMULATION.md)
- [Matriz de repos de prueba (dogfood)](docs/DOGFOOD_REPOS.md)

---

<div align="center">
Hecho para que dejes de programar a ciegas. 
</div>
