import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Claves BYOK del propio auditor: `auditor/.env` (o `ARCHTRACE_ENV_FILE`). El auditor es un proceso aparte,
 * así que no ve `web/.env`. Las variables ya definidas en el entorno tienen prioridad.
 */
export function loadAuditorEnv(): string | null {
  const file = process.env.ARCHTRACE_ENV_FILE?.trim() || path.resolve(__dirname, "..", ".env");
  if (!existsSync(file)) return null;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(before)) process.env[key] = value;
  return file;
}
