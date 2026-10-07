# ArchTrace — dashboard web (Monitor 2)

Next.js App Router + React Flow. En desarrollo: `npm run dev` en el puerto 3000.

## Self-hosted / Docker (Zero-Data Retention)

Arranque local con un solo comando (desde `web/`):

```bash
cp .env.example .env   # opcional: Ollama o claves BYOK
docker compose up -d --build
```

Abre [http://localhost:3000](http://localhost:3000).

### Garantías ZDR

| Control | Comportamiento |
| --- | --- |
| Telemetría | `NEXT_TELEMETRY_DISABLED=1` en build y runtime |
| Persistencia | Sin volúmenes Docker: no se guardan chats, código ni claves en disco del contenedor |
| Secretos | `.env` fuera de la imagen (`.dockerignore`); inyección solo en runtime |
| BYOK | Claves preferibles en `localStorage` del navegador; el servidor solo expone booleanos en `/api/ai/status` |
| Local-first | Con Ollama (`OLLAMA_BASE_URL`) y sin claves cloud, no hay egress a proveedores externos |
| Extensión IDE | `NEXT_PUBLIC_TEACHER_WS_URL` apunta al host (`ws://127.0.0.1:8080`), no al contenedor |

Parar y limpiar el contenedor (sin datos residuales de compose):

```bash
docker compose down
```

## Desarrollo sin Docker

```bash
npm install
npm run dev
```

## Scripts útiles

- `npm run typecheck` — TypeScript
- `npm test` — tests unitarios
- `npm run build` / `npm start` — producción local (requiere `output: 'standalone'` para la imagen)
