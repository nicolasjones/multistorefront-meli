// El agente edita mkdocs.yml; un ':' de más rompe el build de docs. Se avisa antes de abrir el PR.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { erroresYaml, erroresFrontMatter } from "./docs-yaml.mjs";

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

  it("acepta la etiqueta citada con ruta fuera de las comillas", () => {
    const yml = ['nav:', '  - "Service técnico: alta, estados y permisos": producto/service.md'].join("\n");
    assert.deepEqual(erroresYaml(yml), []);
  });

  it("detecta la entrada de nav citada entera con ':' y ruta .md", () => {
    const yml = ['nav:', '  - "Service técnico: producto/service.md"'].join("\n");
    const errs = erroresYaml(yml);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /mkdocs\.yml:2/);
    assert.match(errs[0], /entrecomillada como un solo valor/);
    assert.match(errs[0], /- "Etiqueta": ruta\.md/);
  });

  it("detecta la entrada citada entera con comillas simples", () => {
    const errs = erroresYaml("nav:\n  - 'Stock: producto/stock.md'");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /entrecomillada como un solo valor/);
  });

  it("no marca la entrada citada con dos ':' (MkDocs la trata como título)", () => {
    const yml = ['nav:', '  - "Stock: lotes e inventario: producto/stock.md"'].join("\n");
    assert.deepEqual(erroresYaml(yml), []);
  });

  it("detecta tabuladores", () => {
    const errs = erroresYaml("nav:\n\t- Producto: producto.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /tabulador/);
  });
});

describe("erroresFrontMatter", () => {
  it("un front matter con lista indentada es válido", () => {
    assert.deepEqual(erroresFrontMatter("---\nowner: producto\nsources:\n  - specs\n  - apps/web\n---\n# T\n", "a.md"), []);
  });

  it("detecta un ítem en columna 0 entre ítems indentados", () => {
    const errs = erroresFrontMatter("---\nowner: producto\nsources:\n  - a\n- specs\n---\n# T\n", "a.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /a\.md:5/);
  });

  it("sin front matter no hay errores", () => {
    assert.deepEqual(erroresFrontMatter("# Solo texto\n- item\n", "a.md"), []);
  });

  it("normaliza CRLF y BOM en vez de omitir la página", () => {
    const crlf = "\uFEFF---\r\nowner: producto\r\nsources:\r\n  - a\r\n- specs\r\n---\r\n# T\r\n";
    const errs = erroresFrontMatter(crlf, "a.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /a\.md:5/);
    assert.deepEqual(erroresFrontMatter("\uFEFF---\r\nowner: x\r\nsources: []\r\n---\r\n# T\r\n", "a.md"), []);
  });

  it("detecta un flujo sin cerrar", () => {
    const errs = erroresFrontMatter("---\nowner: x\nsources: [a\n---\n# T\n", "a.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /sin cerrar/);
  });

  it("un front matter vacío es válido y uno sin cerrar se reporta", () => {
    assert.deepEqual(erroresFrontMatter("---\n---\n# T\n", "a.md"), []);
    const errs = erroresFrontMatter("---\nowner: x\n# T\n", "a.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /no se cierra/);
  });

  it("un corchete entre comillas no es un flujo sin cerrar", () => {
    assert.deepEqual(erroresFrontMatter('---\ntitle: "[a"\nowner: x\n---\n# T\n', "a.md"), []);
    assert.deepEqual(erroresFrontMatter("---\ntitle: '{a'\nsources: [a, \"b]\"]\n---\n", "a.md"), []);
    assert.equal(erroresFrontMatter("---\nsources: [a\n---\n", "a.md").length, 1);
  });

  it("una página hostil de 1 MB se analiza en tiempo lineal", () => {
    const casos = [
      "---\nowner: x\n" + "[".repeat(1_000_000),
      "---\nowner: x\nsources: " + "[".repeat(1_000_000) + "\n---\n",
      "---\r" + "a: [\r".repeat(200_000) + "---\r",
      "---\n" + "\n---x".repeat(200_000),
    ];
    for (const c of casos) {
      const t = Date.now();
      erroresFrontMatter(c, "h.md");
      assert.ok(Date.now() - t < 2000, `tardó ${Date.now() - t} ms`);
    }
  });
});
