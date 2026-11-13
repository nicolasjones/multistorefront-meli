// El nav entrecomillado entero y los links que salen de docs/ rompen `mkdocs build --strict`
// aunque el archivo exista en el repo. Se cubren ambos patrones.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { paginasNav, verificarDocumentacion } from "./docs-check.mjs";

function crearRepo(t, mkdocs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs", "_generated"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "diagrams"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "_generated", "inventory.json"),
    JSON.stringify({ rutas: [], tablas: [], variables: [], specs: [] }),
  );
  fs.writeFileSync(path.join(root, "docs", "diagrams", "flujo.html"), "<html></html>");
  fs.writeFileSync(path.join(root, "mkdocs.yml"), mkdocs);
  return root;
}

function escribir(root, rel, contenido = "") {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
  return f;
}

describe("paginasNav", () => {
  it("parsea la etiqueta citada y la entrada citada entera", () => {
    const yml = [
      'nav:',
      '  - "Guía": guia/pagina.md',
      '  - "Otra: cosa": guia/otra.md',
      '  - "Rota: guia/rota.md"',
    ].join("\n");
    assert.deepEqual(paginasNav(yml), ["guia/pagina.md", "guia/otra.md", "guia/rota.md"]);
  });
});

describe("verificarDocumentacion", () => {
  it("acepta un nav con la etiqueta citada y la ruta bajo docs/", (t) => {
    const root = crearRepo(t, 'nav:\n  - "Service técnico: alta y permisos": producto/service.md');
    escribir(root, "docs/producto/service.md", "# Service\n");
    assert.deepEqual(verificarDocumentacion(root).errores, []);
  });

  it("rechaza el nav citado entero", (t) => {
    const root = crearRepo(t, 'nav:\n  - "Service técnico: producto/service.md"');
    escribir(root, "docs/producto/service.md", "# Service\n");
    const errs = verificarDocumentacion(root).errores;
    assert.equal(errs.length, 1);
    assert.match(errs[0], /entrecomillada como un solo valor/);
  });

  it("rechaza un nav citado que apunta a una página inexistente", (t) => {
    const root = crearRepo(t, 'nav:\n  - "Guía": guia/falta.md');
    const errs = verificarDocumentacion(root).errores;
    assert.ok(errs.some((e) => /nav: no existe docs\/guia\/falta\.md/.test(e)), errs.join("\n"));
  });

  it("rechaza un nav que sale de docs/", (t) => {
    const root = crearRepo(t, 'nav:\n  - "Specs": ../specs/spec.md');
    escribir(root, "specs/spec.md", "# Spec\n");
    const errs = verificarDocumentacion(root).errores;
    assert.ok(errs.some((e) => /nav: docs\/\.\.\/specs\/spec\.md queda fuera de docs\//.test(e)), errs.join("\n"));
  });

  it("rechaza un link a un archivo fuera de docs/ aunque exista en el repo", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "specs/011-backups-postgres/spec.md", "# Spec\n");
    escribir(root, "docs/guia/pagina.md", "[spec](../../specs/011-backups-postgres/spec.md)\n");
    const errs = verificarDocumentacion(root).errores;
    assert.ok(
      errs.some((e) => /docs\/guia\/pagina\.md → \.\.\/\.\.\/specs\/011-backups-postgres\/spec\.md \(fuera de docs\/\)/.test(e)),
      errs.join("\n"),
    );
  });

  it("no revisa links de páginas excluidas del sitio (exclude_docs)", (t) => {
    const root = crearRepo(t, 'exclude_docs: |\n  /historica.md\nnav: []');
    escribir(root, "AGENTS.md", "# Agentes\n");
    escribir(root, "docs/historica.md", "[agentes](../AGENTS.md)\n");
    assert.deepEqual(verificarDocumentacion(root).errores, []);
  });

  it("acepta un link interno resuelto dentro de docs/", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/pagina.md", "[otra](otra.md)\n");
    escribir(root, "docs/guia/otra.md", "# Otra\n");
    assert.deepEqual(verificarDocumentacion(root).errores, []);
  });
});
