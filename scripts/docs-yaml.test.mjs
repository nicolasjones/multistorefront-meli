// El agente edita mkdocs.yml; un ':' de más rompe el build de docs. Se avisa antes de abrir el PR.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { erroresYaml } from "./docs-yaml.mjs";

describe("erroresYaml", () => {
  it("un nav válido no da errores", () => {
    const yml = ["nav:", "  - Producto:", "      - Capacidades: producto/capacidades.md"].join("\n");
    assert.deepEqual(erroresYaml(yml), []);
  });

  it("detecta el valor con dos ':'", () => {
    const yml = ["nav:", "  - Producto:", "      - Stock: lotes e inventario: producto/stock.md"].join("\n");
    const errs = erroresYaml(yml);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /mkdocs\.yml:3/);
  });

  it("deja pasar un valor citado con ':'", () => {
    const yml = ['nav:', '  - "Stock: lotes: inventario"'].join("\n");
    assert.deepEqual(erroresYaml(yml), []);
  });

  it("detecta tabuladores", () => {
    const errs = erroresYaml("nav:\n\t- Producto: producto.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /tabulador/);
  });
});
