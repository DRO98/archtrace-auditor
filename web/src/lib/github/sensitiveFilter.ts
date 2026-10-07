/**
 * Filtro previo, en el cliente, de lo que NUNCA se descarga de un repositorio importado.
 * Se aplica sobre las rutas del árbol de Git antes de pedir un solo blob: los secretos ni
 * siquiera llegan a la memoria del navegador.
 */

/** Carpetas que se descartan enteras (en cualquier nivel). */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".turbo",
  ".cache",
  ".aws",
  ".ssh",
  ".gnupg",
  "secrets",
  ".secrets",
]);

/** Extensiones de claves, certificados y almacenes de credenciales. */
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der", ".jks", ".keystore", ".asc", ".gpg", ".kdbx"];

/** Nombres de archivo con credenciales habituales. */
const SECRET_NAMES: ReadonlySet<string> = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".htpasswd",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "service-account.json",
  "secrets.json",
  "secrets.yml",
  "secrets.yaml",
]);

/** `.env`, `.env.local`, `prod.env`… pero no `.env.example` / `.env.sample` / `.env.template`. */
function isEnvFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (/\.(example|sample|template|dist)$/.test(lower)) return false;
  return lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env");
}

export type SensitiveReason = "directory" | "env" | "key" | "credentials";

/** Motivo por el que una ruta se excluye, o `null` si puede descargarse. */
export function sensitiveReason(path: string): SensitiveReason | null {
  const parts = path.split("/").filter((part) => part.length > 0);
  const name = (parts.at(-1) ?? "").toLowerCase();
  if (parts.slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir.toLowerCase()))) return "directory";
  if (EXCLUDED_DIRS.has(name)) return "directory";
  if (isEnvFile(name)) return "env";
  if (SECRET_EXTENSIONS.some((ext) => name.endsWith(ext))) return "key";
  if (SECRET_NAMES.has(name) || /(^|[._-])secrets?([._-]|$)/.test(name)) return "credentials";
  return null;
}

export function isSensitivePath(path: string): boolean {
  return sensitiveReason(path) !== null;
}
