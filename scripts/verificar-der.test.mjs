import test from "node:test";
import assert from "node:assert/strict";
import { verificarDer } from "./verificar-der.mjs";

const ok = `# Spec

## Modelo de datos (DER)

| Tabla | Estado | Cambio |
|---|---|---|
| \`dominio.a\` | nueva | — |
| \`dominio.b\` | alterada | + \`a_id\` (FK) |
| \`dominio.c\` | existente | sin cambios (referencia) |

\`\`\`mermaid
erDiagram
  A ||--o{ B : tiene
  C ||--o{ B : referencia
  A {
    uuid id PK
  }
  B {
    uuid id PK
    uuid a_id FK "alterada: nueva FK a A"
  }
  C {
    uuid id PK
  }
\`\`\`
`;

const sinSeccion = `# Spec\n\n## Esquemas\n\n| Tabla | Esquema |\n|---|---|\n| nueva | dominio |\n`;
const sinLeyenda = `# Spec\n\n## Modelo de datos (DER)\n\n\`\`\`mermaid\nerDiagram\n  A ||--o{ B : tiene\n\`\`\`\n`;
const tablaFuera = `# Spec\n\n## Modelo de datos (DER)\n\n| Tabla | Estado | Cambio |\n|---|---|---|\n| \`a\` | nueva | — |\n| \`z\` | nueva | — |\n\n\`\`\`mermaid\nerDiagram\n  A ||--o{ B : tiene\n\`\`\`\n`;
const alteradaSinMarca = `# Spec\n\n## Modelo de datos (DER)\n\n| Tabla | Estado | Cambio |\n|---|---|---|\n| \`b\` | alterada | + \`a_id\` |\n\n\`\`\`mermaid\nerDiagram\n  B {\n    uuid id PK\n    uuid a_id FK\n  }\n\`\`\`\n`;

test("DER: leyenda + erDiagram + columna alterada marcada", () => {
  assert.equal(verificarDer(ok).ok, true);
});

test("DER: falta la sección", () => {
  const r = verificarDer(sinSeccion);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Modelo de datos/);
});

test("DER: falta la leyenda Tabla/Estado/Cambio", () => {
  const r = verificarDer(sinLeyenda);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /leyenda/);
});

test("DER: la leyenda lista una tabla que no está en el diagrama", () => {
  const r = verificarDer(tablaFuera);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no están en el erDiagram/);
});

test("DER: tabla alterada sin columna marcada", () => {
  const r = verificarDer(alteradaSinMarca);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /alterada/);
});
