import test from "node:test";
import assert from "node:assert/strict";
import { verificarDer } from "./verificar-der.mjs";

const ok = `# Spec\n\n## Modelo de datos (DER)\n\n\`\`\`mermaid\nerDiagram\n  A ||--o{ B : tiene\n  A {\n    uuid id PK\n  }\n\`\`\`\n`;
const sinSeccion = `# Spec\n\n## Esquemas\n\n| Tabla | Esquema |\n|---|---|\n| nueva | dominio |\n`;
const sinEr = `# Spec\n\n## Modelo de datos (DER)\n\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\n`;

test("DER: spec con erDiagram en la sección correcta", () => {
  assert.equal(verificarDer(ok).ok, true);
});

test("DER: falta la sección", () => {
  const r = verificarDer(sinSeccion);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Modelo de datos/);
});

test("DER: la sección existe pero no tiene erDiagram", () => {
  const r = verificarDer(sinEr);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /erDiagram/);
});
