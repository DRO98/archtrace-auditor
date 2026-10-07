import { ApiKeysVault } from "@/features/dashboard/ApiKeysVault";
import { PageShell } from "@/features/dashboard/PageShell";

export default function ApiPage() {
  return (
    <PageShell
      title="API & Integración"
      description="Trae tu propia clave (BYOK) u Ollama / vLLM local. Verifica la conexión, elige el modelo por defecto y ajusta la tarifa de cada uno."
    >
      <ApiKeysVault />
    </PageShell>
  );
}
