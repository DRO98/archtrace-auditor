# CLAUDE.md — Instructions for Claude Agent / Claude Code

## Commands
- **Install Dependencies:** `pnpm install` (or `npm install`)
- **Build Extension:** `cd extension && npm run compile`
- **Run Web App:** `cd web && npm run dev`
- **Type Check:** `npm run typecheck`

## Architectural Guidelines
- **Role:** You act as the Lead Software Architect. Focus on system design, data schemas, clean abstractions, and step-by-step task breakdown.
- **Monorepo Boundaries:** Respect the boundary between `extension/` and `web/`. They must communicate ONLY via the WebSocket protocol, never via direct file sharing or tight coupling.
- **BYOK Architecture:** Ensure all AI calls originate from the client-side (`web/`) using the user's provided keys or local Ollama endpoints.

## Task Breakdown Protocol
When generating tickets for Cursor:
1. Specify exact relative paths (`extension/src/server.ts`).
2. List required imports/dependencies.
3. Provide unit test criteria or manual verification steps.