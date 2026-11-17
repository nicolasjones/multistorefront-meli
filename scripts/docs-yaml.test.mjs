// El agente edita mkdocs.yml; un ':' de más rompe el build de docs. Se avisa antes de abrir el PR.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { erroresYaml, erroresFrontMatter, enlacesMarkdown, LARGO_MAXIMO_LINEA } from "./docs-yaml.mjs";

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
const medir = (fn, s) => { const t = performance.now(); fn(s); return performance.now() - t; };
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
  "corchetes sin cerrar": (n) => "[".repeat(n),
  "abre y destino repetidos": (n) => "[a](".repeat(n / 4),
  "enlaces vacíos repetidos": (n) => "[](".repeat(n / 3),
  "destino larguísimo": (n) => `[a](${"x".repeat(n)}`,
  "título sin cerrar": (n) => '[a](x "'.repeat(n / 7),
};

describe("rendimiento con entradas hostiles (escala lineal)", () => {
  for (const [titulo, fabrica, fn] of [
    ...Object.entries(hostiles).map(([k, f]) => [`front matter: ${k}`, f, (s) => erroresFrontMatter(s, "h.md")]),
    ...Object.entries(enlaces).map(([k, f]) => [`enlaces: ${k}`, f, enlacesMarkdown]),
  ]) {
    it(titulo, () => {
      const t = {};
      fn(fabrica(20 * 1024)); // calentamiento
      for (const kb of [20, 80, 320, 1024]) t[kb] = medir(fn, fabrica(kb * 1024));
      assert.ok(t[1024] < 2000, `1 MB tardó ${t[1024].toFixed(0)} ms`);
      // 4× el tamaño debería costar ≈4×; una regex cuadrática da ≈16×. Piso de 100 ms contra el ruido.
      assert.ok(t[320] < 10 * Math.max(t[80], 100), `80 KB ${t[80].toFixed(0)} ms, 320 KB ${t[320].toFixed(0)} ms`);
      assert.ok(t[1024] < 10 * Math.max(t[320], 100), `320 KB ${t[320].toFixed(0)} ms, 1 MB ${t[1024].toFixed(0)} ms`);
    });
  }
});

describe("enlacesMarkdown", () => {
  it("extrae enlaces con y sin título", () => {
    assert.deepEqual(enlacesMarkdown('a [x](a.md) b ![i](img/p.png "t") [y](b.md#z)').map((m) => m[1]), ["a.md", "img/p.png", "b.md#z"]);
  });
  it("ignora lo que no es un enlace", () => {
    assert.deepEqual(enlacesMarkdown("[a] (b) [c](  d) [e]( ) [f](g"), []);
  });
});
