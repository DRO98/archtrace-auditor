import type { VectorConfig } from "../retrieval/vector";
import { createTestRepo, type TestRepo } from "./gitRepo";

/** Los tests no dependen de que haya un Qdrant/Ollama arrancado en la máquina. */
export const VECTOR_OFF: VectorConfig = { mode: "off", qdrantUrl: "", ollamaUrl: "", embedModel: "" };

export const FIXTURE_CLAUDE = `# Reglas del proyecto

## Autorización

- Todo cambio en permisos (\`has_perm\`, roles, respuestas 403) es crítico y requiere revisión humana.

## Pagos

- Los importes deben guardarse en céntimos (enteros).
`;

const VIEWS_BASE = `from django.http import HttpResponse, HttpResponseForbidden

from .models import Player


class PlayerView:
    def get(self, request, pk):
        return HttpResponse(Player.objects.get(pk=pk).name)

    def delete(self, request, pk):
        Player.objects.filter(pk=pk).first().archive()
        return HttpResponse(status=204)
`;

const VIEWS_HEAD = `from django.http import HttpResponse, HttpResponseForbidden

from .models import Player


class PlayerView:
    def get(self, request, pk):
        return HttpResponse(Player.objects.get(pk=pk).name)

    def delete(self, request, pk):
        if not request.user.has_perm("players.delete_player"):
            return HttpResponseForbidden()
        Player.objects.filter(pk=pk).first().archive()
        return HttpResponse(status=204)
`;

const SERVICE_BASE = `def charge(order, amount):
    amount = amount
    return order.pay(amount)
`;

const SERVICE_HEAD = `def charge(order, amount):
    amount = int(amount)
    return order.pay(amount)
`;

/**
 * Repo de ejemplo: commit base + commit head con un cambio de autorización (has_perm + 403), un cambio de
 * conversión de importe en pagos, un cambio de CSS y un test que toca la vista.
 */
export async function createAuditFixture(): Promise<{ repo: TestRepo; base: string; head: string }> {
  const repo = await createTestRepo("archtrace-fixture-");
  repo.write("CLAUDE.md", FIXTURE_CLAUDE);
  repo.write("players/__init__.py", "");
  repo.write("players/models.py", "class Player:\n    name = ''\n");
  repo.write("players/views.py", VIEWS_BASE);
  repo.write("payments/__init__.py", "");
  repo.write("payments/service.py", SERVICE_BASE);
  repo.write("static/site.css", ".btn {\n  color: blue;\n}\n");
  repo.write("tests/test_players.py", "from players.views import PlayerView\n\n\ndef test_get():\n    assert PlayerView\n");
  const base = await repo.commit("base");
  repo.write("players/views.py", VIEWS_HEAD);
  repo.write("payments/service.py", SERVICE_HEAD);
  repo.write("static/site.css", ".btn {\n  color: red;\n  width: 403px;\n}\n");
  repo.write(
    "tests/test_players.py",
    "from players.views import PlayerView\n\n\ndef test_get():\n    assert PlayerView\n\n\ndef test_delete_requires_perm():\n    assert PlayerView.delete\n",
  );
  const head = await repo.commit("cambios del agente");
  return { repo, base, head };
}
