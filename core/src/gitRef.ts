/** Rama, tag, SHA o expresiones simples (`HEAD~3`, `origin/main`). */
const REF = /^(?!-)[A-Za-z0-9._/@~^{}-]{1,200}$/;

/**
 * Ref de git que se puede pasar como argumento sin riesgo: nada que empiece por `-` (no se cuelan opciones),
 * sin rangos `..` ni reflog `@{`. Compartido por la extensión y el auditor.
 */
export function isSafeRef(ref: string): boolean {
  return REF.test(ref) && !ref.includes("..") && !ref.includes("@{");
}
