# ArchTrace Auditor

Auditor independiente de cambios hechos por agentes de IA. Lee el diff de git, lo trocea por símbolo, aplica
reglas deterministas y las reglas del propio repo (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `docs/`…),
consulta opcionalmente un LLM BYOK con contexto progresivo, valida su respuesta y escribe:

- `Auditoria.md` en la raíz del repo (la auditoría vigente, legible).
- `.archtrace/audits/<id>.json` (fuente de verdad: `AuditRun` de `core/src/audit.ts`).

El índice (blobs parseados, secciones de docs) y la caché del LLM viven fuera del repo, en
`~/.archtrace/index/<hashRepo>/` (`ARCHTRACE_HOME` para cambiarlo). Ambos artefactos se excluyen del análisis.

## CLI

```bash
npm install
npm run audit -- --repo ../mi-repo                         # último commit, solo reglas
npm run audit -- --repo ../mi-repo --mode worktree         # cambios sin commitear + sin seguimiento
npm run audit -- --mode branch --base main --llm anthropic # rama actual desde su merge-base, con LLM
npm run audit -- --mode range --base v1.2 --head HEAD --task JIRA-42 --fail-on critical
node bin/archtrace-audit.cjs --help                        # lanzador usable desde cualquier carpeta
```

`--llm env` usa la primera clave del entorno; `--llm <proveedor>` (`openai`, `anthropic`, `gemini`, `groq`,
`deepseek`, `ollama`) con `--model`. Sin `--llm` no se hace ninguna llamada.

## Claves del LLM (BYOK)

El auditor es un proceso aparte: **no lee `web/.env`**. Hay dos formas de darle una clave:

1. **Desde la UI (recomendada):** API & Integración → elige proveedor, modelo y pega la clave. Al auditar con
   "Clave del navegador", la clave viaja en esa petición y el auditor no la guarda.
2. **En el propio auditor:** copia `.env.example` a `auditor/.env`, rellena las claves y reinicia `npm run serve`.
   En la UI aparece entonces "Claves del auditor"; en la CLI, `--llm env`.

Sin clave, todo funciona igual con reglas deterministas y reglas del repo.

### Si algo falla con el LLM

La auditoría nunca se bloquea: si el proveedor falla, esas unidades se deciden por reglas y el aviso aparece
en la cabecera de la revisión y en `Auditoria.md`.

| Aviso | Qué hacer |
| --- | --- |
| "La clave de X no es válida" | La clave está revocada o mal copiada: vuelve a pegarla. |
| "El modelo … no existe" | Elige otro modelo en API & Integración (la lista muestra los que sirve tu clave). |
| "no está disponible (HTTP 503)" / "no respondió en 60 s" | Proveedor saturado (pasa con modelos nuevos de Gemini): reintenta o elige otro modelo, p. ej. `gemini-3.5-flash`. |
| "falló 3 veces seguidas" | Se dejó de llamar al proveedor en esa auditoría para no esperar en vano. |
| "Tiempo máximo de análisis con LLM agotado" | Diff muy grande: el resto se decidió por reglas (límite de 5 min y 60 unidades). |
| "Origin no permitido" | La web corre en otro puerto: `npm run serve -- --origin http://localhost:3001`. |

## RAG: recuperación de reglas del repo

Para cada unidad se buscan las secciones de documentación de reglas más pertinentes (bloque L4 del prompt):

- **BM25 léxico** en memoria: siempre, sin dependencias.
- **Híbrido BM25 + vectores** si hay Qdrant y Ollama: encuentra reglas aunque no compartan palabras con el
  código (`has_perm` ↔ "control de acceso"). Los dos rankings se combinan con Reciprocal Rank Fusion. Se
  embebe por **sección de documentación y por símbolo, nunca por línea**; los símbolos parecidos de otros
  archivos se añaden al contexto L2.

```bash
cd web && docker compose --profile rag up -d qdrant   # Qdrant en 127.0.0.1:6333
ollama pull nomic-embed-text                         # modelo de embeddings local
```

El índice vectorial es incremental (el id de cada punto es el hash de su contenido: solo se embebe lo nuevo y se
borra lo que ya no existe) y vive en una colección por repo y modelo. Si Qdrant u Ollama no responden, se usa
BM25 sin más; `ARCHTRACE_VECTOR=on` hace que se avise. Todo es local: nada sale de la máquina para embeber.
La línea "Recuperación de reglas" de las métricas de `Auditoria.md` dice qué modo se usó.

## API HTTP (`npm run serve`, 127.0.0.1:8090)

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/health` | Comprobación + proveedor de `auditor/.env` (nunca la clave) |
| GET / POST | `/repos` | Listar (con `available`) / vincular un repo (`{ path }`) e indexarlo |
| DELETE | `/repos/:repoId` | Desvincular (no toca el repo ni sus auditorías) |
| GET | `/repos/:repoId/refs` | Ramas y commits recientes |
| GET / POST | `/repos/:repoId/audits` | Historial / nueva auditoría (`CreateAuditRequest`) |
| GET | `/repos/:repoId/audits/:id` | `AuditRun` completo |
| PATCH | `/repos/:repoId/audits/:id/findings/:fid` | Revisión (`{ status, note }`) → JSON + `Auditoria.md` |
| GET | `/repos/:repoId/files?audit=&side=base\|head&path=` | Contenido para el visor (solo archivos de esa auditoría) |

Seguridad: escucha en loopback, exige `Host` loopback (DNS rebinding), `Origin` en lista blanca
(`--origin`, por defecto `http://localhost:3000` y `http://127.0.0.1:3000`), escrituras solo con
`application/json`. La clave BYOK llega en `POST …/audits` (`ai`), se usa en memoria y no se guarda.
Archivos sensibles (`.env`, claves…) nunca se envían al LLM y las cadenas con pinta de secreto se redactan.

## Pipeline

```
git (4 modos, hunks -U0) → unidades por símbolo (tree-sitter base/head, caché por blob SHA)
  → señales (taxonomy.default.json + .archtrace/taxonomy.json) → reglas del repo (suelo de criticidad)
  → [LLM: contexto L0 hunk → L1 función → L2 estructura (+ símbolos relacionados), + L4 reglas
     (BM25 o híbrido BM25 + Qdrant); máx. 2 escalados; caché]
  → decisión (valida categoría, evidencias literales y reglas existentes; el LLM no baja de un suelo fuerte;
    confianza < 0,5 o sin evidencia → unknown + revisión humana) → Auditoria.md + JSON + métricas
```

Pendiente: nivel L3 por grafo de llamadas (llamadores/llamados del `ProjectMap`), arnés de evaluación
(`auditor/eval/`) y enlace con el plan del agente.
