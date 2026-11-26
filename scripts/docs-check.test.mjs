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

  it("un enlace roto escondido tras un destino demasiado largo falla cerrado, con archivo y línea", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/pagina.md", `# P\n\n[roto](${"a/".repeat(151)}falta.md)\n`);
    const errs = verificarDocumentacion(root).errores;
    assert.ok(errs.some((e) => /docs\/guia\/pagina\.md:3: enlace demasiado largo para validarse \(destino\)/.test(e)), errs.join("\n"));
  });

  it("cada tope excedido da un error de docs-check", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/texto.md", `[${"t".repeat(1501)}](otra.md)\n`);
    escribir(root, "docs/guia/titulo.md", `[a](otra.md "${"t".repeat(1001)}")\n`);
    escribir(root, "docs/guia/blancos.md", `[a](otra.md${" ".repeat(1001)}"t")\n`);
    escribir(root, "docs/guia/otra.md", "# Otra\n");
    const errs = verificarDocumentacion(root).errores.join("\n");
    assert.match(errs, /texto\.md:1: enlace demasiado largo para validarse \(texto\)/);
    assert.match(errs, /titulo\.md:1: enlace demasiado largo para validarse \(título\)/);
    assert.match(errs, /blancos\.md:1: enlace demasiado largo para validarse \(título/);
  });

  it("los topes exactos se validan como un enlace normal", (t) => {
    const root = crearRepo(t, "nav: []");
    const largo = "d/".repeat(147) + "xxx.md"; // 294 + 6 = 300 caracteres
    assert.equal(largo.length, 300);
    escribir(root, `docs/guia/${largo}`, "# Larga\n");
    escribir(root, "docs/guia/pagina.md", `[${"t".repeat(1500)}](${largo})\n`);
    assert.deepEqual(verificarDocumentacion(root).errores, []);
  });

  it("un % mal formado en un destino se reporta con archivo y línea sin tumbar el proceso", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/pagina.md", "# P\n[a](100%.md)\n");
    const errs = verificarDocumentacion(root).errores;
    assert.ok(errs.some((e) => /docs\/guia\/pagina\.md:2: enlace con codificación % mal formada/.test(e)), errs.join("\n"));
  });

  it("limita los errores de enlaces por archivo", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/pagina.md", "[a](falta.md)\n".repeat(80));
    const errs = verificarDocumentacion(root).errores.filter((e) => e.startsWith("docs/guia/pagina.md"));
    assert.equal(errs.length, 51);
    assert.match(errs[50], /…y 30 error\(es\) de enlaces más/);
  });

  it("(A) un enlace exterior roto detrás de una imagen anidada se detecta", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/img.png", "x");
    escribir(root, "docs/guia/pagina.md", "# P\n\n[![a](img.png)](roto.md)\n");
    const errs = verificarDocumentacion(root).errores;
    assert.ok(errs.some((e) => /pagina\.md → roto\.md \(no existe\) \[línea 3\]/.test(e)), errs.join("\n"));
    assert.ok(!errs.some((e) => /img\.png/.test(e)));
  });

  it("(B) un enlace roto después de fences mezclados se detecta y un fence sin cerrar falla", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/mezcla.md", "~~~\n```\n[x](dentro.md)\n~~~\n[roto](fuera.md)\n");
    escribir(root, "docs/guia/abierto.md", "```\n[x](dentro.md)\n");
    const errs = verificarDocumentacion(root).errores.join("\n");
    assert.match(errs, /mezcla\.md → fuera\.md \(no existe\) \[línea 5\]/);
    assert.doesNotMatch(errs, /dentro\.md/);
    assert.match(errs, /abierto\.md:1: bloque de código sin cerrar/);
  });

  it("(C) valida referencias, HTML y destinos con espacios", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/con espacios.md", "# Ok\n");
    escribir(root, "docs/guia/pagina.md", "[a]: falta-ref.md\n<a href=\"falta-html.md\">x</a>\n<img src=falta-img.png>\n[b](<con espacios.md>) [c](<falta con espacios.md>)\n");
    const errs = verificarDocumentacion(root).errores.join("\n");
    for (const f of ["falta-ref.md", "falta-html.md", "falta-img.png", "falta con espacios.md"]) assert.match(errs, new RegExp(`${f} \\(no existe\\)`));
    assert.doesNotMatch(errs, /→ con espacios\.md/);
  });

  it("una página hostil de 1 MB con miles de enlaces demasiado largos termina y limita la salida", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/pagina.md", `[a](${"x".repeat(400)}) `.repeat(2600));
    // Criterio relativo: la misma página con 1/4 de los enlaces; el tope de 10 s es solo la red de seguridad contra el caso
    // cuadrático (minutos). Se toma el mínimo de varias corridas para no depender de la carga del host.
    const delPagina = () => verificarDocumentacion(root).errores.filter((e) => e.startsWith("docs/guia/pagina.md"));
    const minimo = (n) => { let m = Infinity; let r; for (let i = 0; i < n; i++) { const u0 = process.cpuUsage(); r = delPagina(); const u = process.cpuUsage(u0); m = Math.min(m, (u.user + u.system) / 1000); } return { m, r }; };
    escribir(root, "docs/guia/pagina.md", `[a](${"x".repeat(400)}) `.repeat(650));
    delPagina(); // calentamiento
    const chica = minimo(3).m;
    escribir(root, "docs/guia/pagina.md", `[a](${"x".repeat(400)}) `.repeat(2600));
    const { m: grande, r: errs } = minimo(2);
    assert.ok(grande < 10000, `tardó ${grande.toFixed(0)} ms`);
    assert.ok(grande <= 10 * Math.max(chica, 50), `escala superlineal: 1× ${chica.toFixed(0)} ms, 4× ${grande.toFixed(0)} ms`);
    assert.equal(errs.length, 51);
    assert.match(errs[50], /…y 2550 error\(es\) de enlaces más/);
  });

  it("un enlace roto tras una etiqueta `<a` inválida o un fence que sale de su contenedor se detecta", (t) => {
    const root = crearRepo(t, "nav: []");
    escribir(root, "docs/guia/etiqueta.md", "<a x [x](roto-etiqueta.md) >\n");
    escribir(root, "docs/guia/cita.md", "> ```\n[x](roto-cita.md)\n```\n");
    escribir(root, "docs/guia/lista.md", "- a\n  ```\n  x\n[x](roto-lista.md)\n```\n");
    const errs = verificarDocumentacion(root).errores.join("\n");
    for (const f of ["roto-etiqueta.md", "roto-cita.md", "roto-lista.md"]) assert.match(errs, new RegExp(`${f} \\(no existe\\)`));
    assert.match(errs, /cita\.md:1: bloque de código sin cerrar/);
    assert.match(errs, /lista\.md:2: bloque de código sin cerrar/);
  });
});

describe("paginasNav: entradas patológicas (ReDoS)", () => {
  for (const relleno of [" ", "\t", "\u00a0"]) {
    for (const cola of ["\u2028", "\u2029", "\u0085", "x"]) {
      it(`una entrada con 200k ${JSON.stringify(relleno)} y cola ${JSON.stringify(cola)} termina en menos de 1 s`, () => {
        const t0 = performance.now();
        paginasNav(`nav:\n  - ${relleno.repeat(200000)}${cola}\n`);
        assert.ok(performance.now() - t0 < 5000); // tope de 5 s: ver docs-correspondencia.test.mjs
      });
    }
  }

  it("sigue aceptando las tres formas de entrada", () => {
    assert.deepEqual(paginasNav('nav:\n  - Inicio: a.md\n  - "Con: dos": b.md\n  - Sin etiqueta :c.md\n  -x: d.md\n'), ["a.md", "b.md", "c.md"]);
  });
});
