import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRuleDocument, sectionize } from "./sections";

const CLAUDE = `# Reglas del proyecto

Intro sin reglas.

## Autorización

- Todo cambio en permisos (\`has_perm\`, roles, 403) es crítico y requiere revisión humana.
- Las vistas deben comprobar permisos.

\`\`\`python
# Esto no es un encabezado
nunca = True
\`\`\`

## Pagos

Los importes deben guardarse en céntimos (enteros).

### Autorización
Subsección con el mismo título.
`;

describe("sectionize", () => {
  const sections = sectionize("CLAUDE.md", CLAUDE);

  it("trocea por encabezados con ruta, líneas e ids estables", () => {
    assert.deepEqual(
      sections.map((section) => [section.id, section.headingPath.join(" > "), section.lines.startLine, section.lines.endLine]),
      [
        ["CLAUDE.md#reglas-del-proyecto", "Reglas del proyecto", 1, 4],
        ["CLAUDE.md#autorizacion", "Reglas del proyecto > Autorización", 5, 14],
        ["CLAUDE.md#pagos", "Reglas del proyecto > Pagos", 15, 18],
        ["CLAUDE.md#autorizacion-2", "Reglas del proyecto > Pagos > Autorización", 19, 20],
      ],
    );
  });

  it("extrae frases de regla y marca las críticas, ignorando bloques de código", () => {
    const authz = sections[1]!;
    assert.deepEqual(
      authz.rules.map((rule) => [rule.line, rule.critical]),
      [
        [7, true],
        [8, false],
      ],
    );
    assert.match(authz.rules[0]!.text, /^Todo cambio en permisos/);
    assert.deepEqual(sections[2]!.rules.map((rule) => [rule.line, rule.critical]), [[17, false]]);
  });

  it("salta el front matter de .mdc y crea sección de preámbulo sin encabezados", () => {
    const mdc = sectionize(".cursor/rules/db.mdc", "---\nglobs: **/*.py\n---\nNunca uses SQL crudo fuera de repositories/.\n");
    assert.equal(mdc.length, 1);
    assert.equal(mdc[0]!.id, ".cursor/rules/db.mdc#_");
    assert.deepEqual(mdc[0]!.rules.map((rule) => rule.line), [4]);
  });
});

describe("isRuleDocument", () => {
  it("reconoce los documentos de reglas", () => {
    for (const file of ["CLAUDE.md", "web/CLAUDE.md", "AGENTS.md", ".cursorrules", ".cursor/rules/a.mdc", ".claude/agents/x.md", "docs/arch.md", "README.md"]) {
      assert.equal(isRuleDocument(file), true, file);
    }
    for (const file of ["src/readme.md", "notes.md", "docs/img.png"]) assert.equal(isRuleDocument(file), false, file);
  });
});
