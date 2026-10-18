import { afterEach, beforeEach, describe, expect, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { motivoSpecSinMatriz, specsExentas } from "./verificar-matriz-pantalla.mjs";

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-matriz-"));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const escribir = (nombre, contenido) => {
  const destino = path.join(dir, nombre);
  fs.writeFileSync(destino, contenido);
  return destino;
};

describe("verificar-matriz-pantalla", () => {
  it("pide la matriz a una spec que toca pantallas", () => {
    const spec = escribir("spec.md", "# Spec\n\nImplementa `apps/web/src/pages/clientes/list.tsx`.\n");
    assert.equal(motivoSpecSinMatriz(spec), spec);
  });

  it("pide la matriz si referencia el prototipo", () => {
    const spec = escribir("spec.md", "# Spec\n\nSigue `design/pantallas/Clientes.dc.html`.\n");
    assert.equal(motivoSpecSinMatriz(spec), spec);
  });

  it("no pide la matriz si ya está declarada", () => {
    const spec = escribir("spec.md", "# Spec\n\n`apps/web/src/pages/x.tsx`\n\n## Matriz pantalla↔criterios\n\n- Tabla Clientes → CA-1\n");
    assert.equal(motivoSpecSinMatriz(spec), null);
  });

  it("ignora specs sin UI", () => {
    const spec = escribir("spec.md", "# Spec\n\nSólo cambia `supabase/migrations`.\n");
    assert.equal(motivoSpecSinMatriz(spec), null);
  });

  it("ignora un spec.md inexistente", () => {
    assert.equal(motivoSpecSinMatriz(path.join(dir, "nope.md")), null);
  });

  it("lee la lista de specs exentas ignorando comentarios", () => {
    const archivo = path.join(dir, "exentas.txt");
    fs.writeFileSync(archivo, "# comentario\n\nspecs/una-vieja\nspecs/otra  # con nota\n");
    const exentas = specsExentas(archivo);
    expect([...exentas].sort()).toEqual(["specs/otra", "specs/una-vieja"]);
  });

  it("no explota si el archivo de exentas no existe", () => {
    assert.equal(specsExentas(path.join(dir, "no-existe.txt")).size, 0);
  });
});
