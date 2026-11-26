// El agente edita mkdocs.yml; un ':' de más rompe el build de docs. Se avisa antes de abrir el PR.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { erroresYaml, erroresFrontMatter, enlacesMarkdown, LARGO_MAXIMO_LINEA, esBlanco, MAX_ETIQUETA_HTML, MAX_TEXTO_ENLACE, MAX_DESTINO_ENLACE, MAX_TITULO_ENLACE, MAX_BLANCOS_ENLACE, MAX_EXCESOS_ENLACE } from "./docs-yaml.mjs";

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

  it("casos de corrección con comillas y escapes", () => {
    const e = (v) => erroresFrontMatter(`---\nt: ${v}\n---\n`, "a.md").length;
    assert.equal(e('[ "x'), 1);
    assert.equal(e('["a", [b'), 1);
    assert.equal(e('["a\\"]", [b'), 1);
    assert.equal(e('["a]", [b'), 1);
    assert.equal(e("[a, 'b"), 1);
    assert.equal(e('["a\\"]", b]'), 0);
    assert.equal(e('["a]", b]'), 0);
  });

  it("una línea de más de 10.000 caracteres se reporta sin analizarla", () => {
    const errs = erroresFrontMatter(`---\nt: [${"a".repeat(LARGO_MAXIMO_LINEA)}\n---\n`, "a.md");
    assert.equal(errs.length, 1);
    assert.match(errs[0], /demasiado larga/);
  });

  it("CR suelto como separador de línea también se analiza", () => {
    assert.equal(erroresFrontMatter("---\rsources:\r  - a\r- specs\r---\r", "a.md").length, 1);
  });
});

// Entradas hostiles: el tiempo tiene que escalar de forma lineal (no cuadrática) con el tamaño.
// Tiempo de CPU del proceso (no de pared): una CPU saturada por otros procesos no infla la medida, una regresión superlineal sí.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const medir = (fn, s) => { const t = cpuMs(); fn(s); return cpuMs() - t; };
const hostiles = {
  "comilla con escapes sin cierre": (n) => `---\nt: [ "${'\\"'.repeat(n / 2)}\n---\n`,
  "comilla simple sin cerrar": (n) => `---\nt: [ '${"a".repeat(n)}\n---\n`,
  "barras invertidas": (n) => `---\nt: ["${"\\\\".repeat(n / 2)}\n---\n`,
  "comillas alternadas": (n) => `---\nt: [${"\"'".repeat(n / 2)}\n---\n`,
  "corchetes anidados": (n) => `---\nt: ${"[".repeat(n)}\n---\n`,
  "muchas líneas con flujo": (n) => `---\n${'a: ["\\"\n'.repeat(n / 7)}---\n`,
  "sin cierre": (n) => `---\n${"x: 1\n".repeat(n / 5)}`,
  "CR repetidos": (n) => `---\r${"a: [\r".repeat(n / 5)}---\r`,
};
const enlaces = {
  "<a sin cierre": (n) => "<a ".repeat(n / 3),
  "fences dentro de HTML": (n) => "<div>\n```\n".repeat(n / 11),
  "ítems hermanos con fence": (n) => "- ~~~\n- [a](b)\n".repeat(n / 17),
  "citas en listas": (n) => "- > ```\n> x\n".repeat(n / 13),
  "<img sin cierre": (n) => "<img ".repeat(n / 5),
  "<a href con comilla abierta": (n) => '<a href="'.repeat(n / 9),
  "fences en cita": (n) => "> ```\n".repeat(n / 6),
  "fences en lista": (n) => "- ```\n  x\n".repeat(n / 10),
  "fences en lista sin cierre": (n) => "- a\n  ```\n[x](y)\n".repeat(n / 20),
  "definiciones multilínea": (n) => "> - [x]: a\n   \"t\"\n".repeat(n / 16),
  "corchetes anidados": (n) => "[".repeat(n / 2) + "](x)".repeat(n / 8),
  "fences alternados": (n) => "```\n~~~\n".repeat(n / 8),
  "fences de longitud creciente": (n) => Array.from({ length: Math.floor(Math.sqrt(n)) }, (_, k) => "`".repeat(3 + (k % 50)) + "\n").join(""),
  "etiquetas html": (n) => "<a href=".repeat(n / 8),
  "etiquetas html con comilla": (n) => '<a href="'.repeat(n / 9),
  "definiciones": (n) => "[x]:".repeat(n / 4),
  "definiciones con destino": (n) => "[x]: y\n".repeat(n / 7),
  "escapes": (n) => "\\[".repeat(n / 2),
  "destino con <": (n) => "[a](<".repeat(n / 5),
  "corchetes sin cerrar": (n) => "[".repeat(n),
  "abre y destino repetidos": (n) => "[a](".repeat(n / 4),
  "enlaces vacíos repetidos": (n) => "[](".repeat(n / 3),
  "destino larguísimo": (n) => `[a](${"x".repeat(n)}`,
  "título sin cerrar": (n) => '[a](x "'.repeat(n / 7),
};

// Miles de enlaces que exceden un tope: reportarlos no puede costar más que O(n).
const enlacesLargos = {
  "destinos de 301": (n) => `[a](${"x".repeat(MAX_DESTINO_ENLACE + 1)}) `.repeat(n / (MAX_DESTINO_ENLACE + 8)),
  "textos de 1501": (n) => `[${"t".repeat(MAX_TEXTO_ENLACE + 1)}](a.md) `.repeat(n / (MAX_TEXTO_ENLACE + 10)),
  "títulos de 1001": (n) => `[a](b "${"t".repeat(MAX_TITULO_ENLACE + 1)}") `.repeat(n / (MAX_TITULO_ENLACE + 12)),
  "blancos de 1001": (n) => `[a](b${" ".repeat(MAX_BLANCOS_ENLACE + 1)}"t") `.repeat(n / (MAX_BLANCOS_ENLACE + 12)),
};

// Criterio RELATIVO y robusto a la carga del host: calentamiento, MÍNIMO de varias muestras por tamaño (un pico de CPU de otro
// proceso no cuenta, una regresión real sí: afecta a todas las muestras), piso de tiempo y razón de crecimiento por 4× de
// tamaño (lineal ≈ 4×, cuadrático ≈ 16×; el límite es 10×). El tope absoluto de 10 s es solo una red de seguridad contra el
// caso cuadrático real (que tarda minutos): no es el criterio de linealidad.
const MUESTRAS = 3;
const PISO_MS = 20;
const RAZON_MAXIMA = 10;
const TOPE_ABSOLUTO_MS = 10000;
const minimo = (fn, s, muestras) => { let m = Infinity; for (let i = 0; i < muestras; i++) m = Math.min(m, medir(fn, s)); return m; };

describe("rendimiento con entradas hostiles (escala lineal)", () => {
  for (const [titulo, fabrica, fn] of [
    ...Object.entries(hostiles).map(([k, f]) => [`front matter: ${k}`, f, (s) => erroresFrontMatter(s, "h.md")]),
    ...Object.entries(enlaces).map(([k, f]) => [`enlaces: ${k}`, f, enlacesMarkdown]),
    ...Object.entries(enlacesLargos).map(([k, f]) => [`enlaces demasiado largos: ${k}`, f, enlacesMarkdown]),
  ]) {
    it(titulo, () => {
      const t = {};
      fn(fabrica(20 * 1024)); // calentamiento
      for (const kb of [80, 320, 1024]) {
        const entrada = fabrica(kb * 1024);
        t[kb] = minimo(fn, entrada, kb >= 1024 ? 2 : MUESTRAS);
      }
      assert.ok(t[1024] < TOPE_ABSOLUTO_MS, `1 MB tardó ${t[1024].toFixed(0)} ms`);
      assert.ok(t[320] <= RAZON_MAXIMA * Math.max(t[80], PISO_MS), `80 KB ${t[80].toFixed(0)} ms, 320 KB ${t[320].toFixed(0)} ms`);
      assert.ok(t[1024] <= RAZON_MAXIMA * Math.max(t[320], PISO_MS), `320 KB ${t[320].toFixed(0)} ms, 1 MB ${t[1024].toFixed(0)} ms`);
    });
  }
});

describe("enlacesMarkdown", () => {
  const destinos = (s) => enlacesMarkdown(s).enlaces.map((m) => m.destino);
  it("extrae enlaces con y sin título, con su línea", () => {
    const r = enlacesMarkdown('a [x](a.md) b\n![i](img/p.png "t") [y](b.md#z)');
    assert.deepEqual(r.enlaces.map((m) => [m.destino, m.linea]), [["a.md", 1], ["img/p.png", 2], ["b.md#z", 2]]);
  });
  it("ignora lo que no es un enlace", () => {
    const r = enlacesMarkdown("[a] (b) [c](  d) [e]( ) [f](g");
    assert.deepEqual(r.enlaces.map((m) => m.destino), ["d"]);
    assert.deepEqual([r.excesos, r.masExcesos, r.sinCerrar], [[], 0, []]);
  });
  it("(A) valida el enlace exterior de una imagen anidada", () => {
    assert.deepEqual(destinos("[![a](i.png)](roto.md)"), ["i.png", "roto.md"]);
    assert.deepEqual(destinos("[x [![a](i.png)](y.md) z](w.md)"), ["i.png", "y.md", "w.md"]);
  });
  it("(B) fences conforme a CommonMark: cierra solo con el mismo carácter y longitud suficiente", () => {
    const cod = "[ok](dentro.md)";
    for (const [ab, mid, ce] of [["~~~", "```", "~~~"], ["````", "```", "````"], ["```", "~~~", "```"], ["~~~~", "~~~", "~~~~"]]) {
      const r = enlacesMarkdown(`${ab}\n${cod}\n${mid}\n${cod}\n${ce}\n[fuera](roto.md)\n`);
      assert.deepEqual(r.enlaces.map((m) => [m.destino, m.linea]), [["roto.md", 6]], `${ab}/${mid}/${ce}`);
      assert.deepEqual(r.sinCerrar, []);
    }
  });
  it("(B) un fence sin cerrar se reporta y lo que sigue sigue siendo código", () => {
    const r = enlacesMarkdown("[a](a.md)\n```\n[b](b.md)\n");
    assert.deepEqual(r.enlaces.map((m) => m.destino), ["a.md"]);
    assert.deepEqual(r.sinCerrar, [2]);
    assert.deepEqual(enlacesMarkdown("``` x\n~~~\n```\n[c](c.md)").enlaces.map((m) => m.destino), ["c.md"]);
    assert.deepEqual(enlacesMarkdown("```a`b\n[c](c.md)").enlaces.map((m) => m.destino), ["c.md"]); // no es un fence (backtick en la info)
  });
  it("(C) definiciones de referencia, HTML, destinos con espacios y corchete escapado", () => {
    assert.deepEqual(destinos('[x]: roto.md "título"\n  [y]: <con espacios.md>\n[^1]: nota larga\n[Nota]: ver más\ntexto [x]: no.md'), ["roto.md", "con espacios.md"]);
    assert.deepEqual(destinos('<a href="a.md">x</a> <A HREF=b.md> <img alt=x src=\'i.png\'> <abbr title="t"> <https://x.org>'), ["a.md", "b.md", "i.png"]);
    assert.deepEqual(destinos("[a](<con espacios.md>) [b](<x.md> \"t\")"), ["con espacios.md", "x.md"]);
    // Sin manejo de escapes (como el extractor anterior): `\\[c](y.md)` se valida y `[a\\]b](x.md)` es un límite documentado.
    assert.deepEqual(destinos("[a\\]b](x.md) \\[c](y.md)"), ["y.md"]);
  });
  it("(D) esBlanco equivale a /\\s/ (NBSP y blancos Unicode separan el destino)", () => {
    for (let k = 0; k < 0x10000; k++) assert.equal(esBlanco(String.fromCharCode(k)), /\s/.test(String.fromCharCode(k)), k.toString(16));
    for (const b of ["\u00a0", "\u2003", "\u3000", "\u2028", "\ufeff"]) {
      assert.deepEqual(destinos(`[a](x${b}y)`), [], "sin cierre tras el blanco");
      assert.deepEqual(destinos(`[a](x${b}"t")`), ["x"]);
    }
  });
  it("CRLF, CR suelto y BOM se analizan igual que LF, con las mismas líneas", () => {
    const lf = "# t\n\n[x]: roto.md\n[y]: otro.md \"t\"\n[a](b.md) <a href=\"h.md\"> <img src=i.png>\n```\n[c](dentro.md)\n```\n[f](fuera.md)\n";
    const base = enlacesMarkdown(lf);
    assert.deepEqual(base.enlaces.map((m) => [m.destino, m.linea]), [["roto.md", 3], ["otro.md", 4], ["b.md", 5], ["h.md", 5], ["i.png", 5], ["fuera.md", 9]]);
    for (const variante of [lf.replace(/\n/g, "\r\n"), lf.replace(/\n/g, "\r"), "\uFEFF" + lf, "\uFEFF" + lf.replace(/\n/g, "\r\n")]) {
      const r = enlacesMarkdown(variante);
      assert.deepEqual(r.enlaces.map((m) => [m.destino, m.linea]), base.enlaces.map((m) => [m.destino, m.linea]));
      assert.deepEqual(r.sinCerrar, []);
    }
    assert.deepEqual(destinos("[x]: roto.md\r\n"), ["roto.md"]);
    assert.deepEqual(destinos("[x]: roto.md \"título\"\r\n[y]: <con espacios.md>\r\n"), ["roto.md", "con espacios.md"]);
  });
  it("un fence con BOM en la línea 1 se reconoce como apertura", () => {
    assert.deepEqual(destinos("\uFEFF```\n[x](dentro.md)\n```\n[f](fuera.md)\n"), ["fuera.md"]);
  });
  it("mutantes: nota al pie, blanco antes de href/src y basura tras una definición", () => {
    assert.deepEqual(destinos("[^1]: roto.md\n[^nota]: <roto2.md>"), []);
    assert.deepEqual(destinos('<a data-href="x.md"> <img data-src=y.png> <abbr href="z.md"> <a  href="ok.md">'), ["ok.md"]);
    assert.deepEqual(destinos('[a]: r.md "t" basura\n[b]: r2.md (t) x\n[c]: r3.md\n  "título aparte" más'), ["r3.md"]);
    assert.deepEqual(destinos("[a]: r.md texto\n[d]: ok.md"), ["ok.md"]);
  });
  const caso = (nombre, ok, mal, motivo) => it(`tope de ${nombre}: el límite se valida y uno más se reporta`, () => {
    const a = enlacesMarkdown(ok);
    assert.equal(a.enlaces.length, 1, "el límite exacto se procesa");
    assert.deepEqual(a.excesos, []);
    const b = enlacesMarkdown(`\nlinea\n${mal}`);
    assert.equal(b.enlaces.length, 0);
    assert.equal(b.excesos.length, 1);
    assert.equal(b.excesos[0].linea, 3);
    assert.match(b.excesos[0].motivo, new RegExp(motivo));
  });
  caso("destino", `[a](${"x".repeat(MAX_DESTINO_ENLACE)})`, `[a](${"x".repeat(MAX_DESTINO_ENLACE + 1)})`, "destino");
  caso("destino en definición", `[a]: ${"x".repeat(MAX_DESTINO_ENLACE)}`, `[a]: ${"x".repeat(MAX_DESTINO_ENLACE + 1)}`, "destino");
  caso("destino en etiqueta HTML", `<a href="${"x".repeat(MAX_DESTINO_ENLACE)}">`, `<a href="${"x".repeat(MAX_DESTINO_ENLACE + 1)}">`, "destino");
  caso("texto", `[${"t".repeat(MAX_TEXTO_ENLACE)}](a.md)`, `[${"t".repeat(MAX_TEXTO_ENLACE + 1)}](a.md)`, "texto");
  caso("título", `[a](b "${"t".repeat(MAX_TITULO_ENLACE)}")`, `[a](b "${"t".repeat(MAX_TITULO_ENLACE + 1)}")`, "título");
  caso("blancos antes del título", `[a](b${" ".repeat(MAX_BLANCOS_ENLACE)}"t")`, `[a](b${" ".repeat(MAX_BLANCOS_ENLACE + 1)}"t")`, "título");
  it("una etiqueta HTML de más de 1000 caracteres no se analiza (límite documentado) y no oculta enlaces", () => {
    const r = enlacesMarkdown(`<a ${"x ".repeat(MAX_ETIQUETA_HTML)}href="a.md"> [b](b.md)`);
    assert.deepEqual(r.enlaces.map((m) => m.destino), ["b.md"]);
    assert.deepEqual(r.excesos, []);
  });
  it("(1) una etiqueta `<a` o `<img` que no es válida no consume los enlaces que la siguen", () => {
    assert.deepEqual(destinos("<a x [x](../../etc/passwd) >"), ["../../etc/passwd"]);
    assert.deepEqual(destinos("<a x\n[x](roto.md)"), ["roto.md"]);
    assert.deepEqual(destinos("<img [x](roto.md) alt=y>"), ["roto.md"]);
    assert.deepEqual(destinos('<a href="a.md" [x](roto.md)>'), ["a.md", "roto.md"]);
    assert.deepEqual(destinos('<img alt="[x](r.md)" src=i.png>'), ["i.png", "r.md"]);
    assert.deepEqual(destinos("<a <a <a [x](roto.md)"), ["roto.md"]);
  });
  it("(4) el > entre comillas de un atributo no esconde el src", () => {
    assert.deepEqual(destinos('<img alt="x>y" src="i.png">'), ["i.png"]);
    assert.deepEqual(destinos("<a title='a>b' href=\"h.md\">"), ["h.md"]);
  });
  it("(2) un fence abierto dentro de una cita o lista cierra solo dentro de su contenedor", () => {
    for (const s of ["- a\n  ```\n  x\n[x](roto.md)\n```\n", "> ```\n[x](roto.md)\n```\n", "1. a\n   ~~~\n   x\n[x](roto.md)\n~~~\n"]) {
      const r = enlacesMarkdown(s);
      assert.deepEqual(r.enlaces.map((m) => m.destino), ["roto.md"], s);
      assert.equal(r.sinCerrar.length >= 1, true, s);
    }
    const ok = enlacesMarkdown("- a\n  ```\n  [x](dentro.md)\n\n  ```\n[f](fuera.md)\n> ```\n> [y](dentro2.md)\n> ```\n[g](fuera2.md)\n");
    assert.deepEqual(ok.enlaces.map((m) => m.destino), ["fuera.md", "fuera2.md"]);
    assert.deepEqual(ok.sinCerrar, []);
  });
  it("QA: un ítem hermano de lista termina el fence (`-`, `*`, `+` y numerada)", () => {
    for (const s of ["- ~~~\n- [a](roto.md)\n- ~~~\n", "* ~~~\n* [a](roto.md)\n* ~~~\n", "+ ~~~\n+ [a](roto.md)\n+ ~~~\n", "1. ~~~\n2. [a](roto.md)\n3. ~~~\n", "- a\n  - ```\n  - [a](roto.md)\n"]) {
      const r = enlacesMarkdown(s);
      assert.ok(r.enlaces.some((m) => m.destino === "roto.md"), s);
      assert.ok(r.sinCerrar.length >= 1, s);
    }
  });
  it("QA: una cita dentro de una lista no es continuación de una cita sola (pila de contenedores)", () => {
    for (const s of ["- > ~~~\n> [a](roto.md)\n> ~~~\n", "> - ```\n> [a](roto.md)\n> ```\n", "- > ```\n  > [a](dentro.md)\n  > ```\n[f](fuera.md)\n"]) {
      const r = enlacesMarkdown(s);
      if (s.includes("dentro.md")) { assert.deepEqual(r.enlaces.map((m) => m.destino), ["fuera.md"]); assert.deepEqual(r.sinCerrar, []); }
      else { assert.ok(r.enlaces.some((m) => m.destino === "roto.md"), s); assert.ok(r.sinCerrar.length >= 1, s); }
    }
  });
  it("QA: el cierre de un fence exige los mismos contenedores (una línea de otro contenedor no cierra)", () => {
    for (const marca of ["> ~~~", "- ~~~", "  - ~~~", "1. ~~~", "> - ~~~", "* ~~~"]) {
      const s = `~~~\nx\n${marca}\n~~~\n[a](roto.md)\n~~~\n`;
      const r = enlacesMarkdown(s);
      assert.ok(r.enlaces.some((m) => m.destino === "roto.md"), s);
      assert.ok(r.sinCerrar.length >= 1, s); // el último `~~~` abre un fence que no se cierra
    }
    // Mezcla de backticks y tildes: la línea de otro carácter tampoco cierra.
    const mezcla = enlacesMarkdown("```\n> ```\n~~~\n```\n[a](roto.md)\n");
    assert.deepEqual(mezcla.enlaces.map((m) => m.destino), ["roto.md"]);
    // Caso inverso: apertura en cita; una valla sin `>` no cierra (el contenedor terminó) y se reporta.
    const inverso = enlacesMarkdown("> ~~~\n> x\n~~~\n[a](roto.md)\n");
    assert.ok(inverso.sinCerrar.includes(1) && inverso.sinCerrar.includes(3)); // la cita termina sin cierre y la nueva valla abre otro fence
    assert.deepEqual(destinos("> ~~~\n> x\n~~~\n~~~\n[a](roto.md)\n"), ["roto.md"]);
    // Cierres válidos siguen cerrando.
    assert.deepEqual(destinos("> ~~~\n> [x](dentro.md)\n> ~~~\n[f](fuera.md)\n"), ["fuera.md"]);
    assert.deepEqual(destinos("- a\n  ```\n  [x](dentro.md)\n  ```\n[f](fuera.md)\n"), ["fuera.md"]);
    assert.deepEqual(destinos("```\n[x](dentro.md)\n   ```\n[f](fuera.md)\n"), ["fuera.md"]);
  });
  it("QA: no se abre un fence dentro de un bloque HTML (se valida de más)", () => {
    for (const s of ["<div>\n~~~\n\n[a](roto.md)\n~~~\n", "<!-- x\n~~~\n\n[a](roto.md)\n-->\n", "<pre>\n```\n[a](roto.md)\n</pre>\n```\n", "<details>\n~~~\n[a](roto.md)\n"]) {
      assert.ok(destinos(s).includes("roto.md"), s);
    }
    // Una línea vacía termina el bloque HTML y el fence siguiente se abre con normalidad.
    assert.deepEqual(destinos("<div>\n\n```\n[x](dentro.md)\n```\n[f](fuera.md)\n"), ["fuera.md"]);
    assert.deepEqual(destinos("<!-- c -->\n```\n[x](dentro.md)\n```\n[f](fuera.md)\n"), ["fuera.md"]);
  });
  it("(5) un fence en la misma línea del marcador de lista se abre y se cierra bien", () => {
    const r = enlacesMarkdown("- ```\n  [x](dentro.md)\n  ```\n- [y](fuera.md)\n");
    assert.deepEqual(r.enlaces.map((m) => m.destino), ["fuera.md"]);
    assert.deepEqual(r.sinCerrar, []);
    assert.deepEqual(enlacesMarkdown("1. ```js\n   x\n   ```\n").sinCerrar, []);
  });
  it("(3) definiciones dentro de cita o lista, con destino o título en la línea siguiente o entre paréntesis", () => {
    assert.deepEqual(destinos("> [a]: r1.md\n- [b]: r2.md (título)\n1. [c]:\n   r3.md\n[d]: r4.md\n  \"t\"\n[e]: r5.md 'x'"), ["r1.md", "r2.md", "r3.md", "r4.md", "r5.md"]);
    assert.deepEqual(destinos("[a]: r.md texto de más\nprosa [b]: no.md"), []);
    assert.deepEqual(destinos("[a](b.md (título))"), ["b.md"]);
  });
  it("limita los excesos guardados y cuenta el resto", () => {
    const r = enlacesMarkdown(`[a](${"x".repeat(MAX_DESTINO_ENLACE + 1)}) `.repeat(MAX_EXCESOS_ENLACE + 25));
    assert.equal(r.excesos.length, MAX_EXCESOS_ENLACE);
    assert.equal(r.masExcesos, 25);
  });
  it("un enlace normal después de uno demasiado largo se sigue extrayendo", () => {
    assert.deepEqual(destinos(`[a](${"x".repeat(MAX_DESTINO_ENLACE + 1)}) [b](ok.md)`), ["ok.md"]);
  });
});

describe("erroresYaml: entradas patológicas (ReDoS)", () => {
  for (const relleno of [" ", "\t", "\u00a0"]) {
    for (const cola of ["\u2028", "\u2029", "\u0085"]) {
      it(`un ítem con 200k ${JSON.stringify(relleno)} y cola ${JSON.stringify(cola)} termina en menos de 1 s`, () => {
        const t0 = performance.now();
        erroresYaml(`nav:\n  - ${relleno.repeat(200000)}${cola}\n`);
        assert.ok(performance.now() - t0 < 1000);
      });
    }
  }
});
