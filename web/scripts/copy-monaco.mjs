// Copia `monaco-editor/min/vs` (paquete local) a `public/monaco/vs` para que el loader de
// `@monaco-editor/react` no use el CDN por defecto (coherente con zero-retention). Idempotente por versión.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(web, "node_modules", "monaco-editor");
const target = path.join(web, "public", "monaco");
const marker = path.join(target, ".version");
const version = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).version;

if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version) process.exit(0);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(path.join(source, "min", "vs"), path.join(target, "vs"), { recursive: true });
writeFileSync(marker, `${version}\n`);
console.log(`monaco-editor ${version} → public/monaco/vs`);
