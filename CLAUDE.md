# CLAUDE.md — Instructions for Claude Agent / Claude Code

## Commands
- **Install Dependencies:** `npm run install:all` (each package — `scanner/`, `llm/`, `auditor/`, `extension/`, `web/` — owns its `node_modules`)
- **Build Extension:** `cd extension && npm run compile`
- **Run Web App:** `cd web && npm run dev`
- **Run Auditor:** `cd auditor && npm run serve` (HTTP on 127.0.0.1:8090) or `npm run audit -- --repo <dir>` (CLI)
- **Type Check:** `npm run typecheck`
- **Tests:** `npm test`

## Architectural Guidelines
- **Role:** You act as the Lead Software Architect. Focus on system design, data schemas, clean abstractions, and step-by-step task breakdown.
- **Monorepo Boundaries:** Respect the boundary between `extension/` and `web/`. They must communicate ONLY via the WebSocket protocol, never via direct file sharing or tight coupling. `web/` talks to `auditor/` ONLY via its local HTTP API (`web/src/lib/auditor/client.ts`). Shared code lives in `core/` (types + pure functions), `scanner/` (tree-sitter, `@scanner/*`) and `llm/` (BYOK providers, `@llm/*`; `web/src/lib/ai/*` re-exports it).
- **BYOK Architecture:** Ensure all AI calls originate from the client-side (`web/`) using the user's provided keys or local Ollama endpoints.
  - **Explicit extension for `auditor/`:** the auditor is a local process on the user's machine (it must read git and the repo). Its LLM calls use the key sent by the browser in each `POST /repos/:id/audits` request (used in memory, never persisted or logged) or, in CLI mode, keys from the environment / local Ollama. Sensitive files (`core/src/sensitivePaths.ts`) and secret-looking strings never reach the LLM.

## Task Breakdown Protocol
When generating tickets for Cursor:
1. Specify exact relative paths (`extension/src/server.ts`).
2. List required imports/dependencies.
3. Provide unit test criteria or manual verification steps.