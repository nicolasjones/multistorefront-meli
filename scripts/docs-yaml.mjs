// Errores de YAML que rompen el build estricto de MkDocs.
//
// El agente (Documentador) edita `mkdocs.yml` para agregar páginas al nav. Los patrones que
// rompen el build son:
//   - un valor con dos ':' ("- Stock: lotes e inventario: producto/stock-lotes.md");
//   - toda la entrada entrecomillada como un solo escalar
//     ('- "Stock: producto/stock.md"'), que MkDocs lee como título y no como página;
//   - tabuladores en la indentación.
//
// La forma correcta es entrecomillar sólo la etiqueta cuando lleve ':':
//   - "Stock: lotes e inventario": producto/stock-lotes.md
//
// Esto es determinista y sin dependencias: no hace falta un parser YAML completo.

/**
 * Detecta una entrada de nav citada como un solo escalar ('- "Etiqueta: ruta.md"').
 * Devuelve el contenido interior o null si la entrada es válida (sólo la etiqueta va citada).
 */
function navEnteramenteEntrecomillado(resto) {
  const comilla = resto[0];
  if (comilla !== '"' && comilla !== "'") return null;
  const cierre = resto.lastIndexOf(comilla);
  if (cierre <= 0) return null;
  const interior = resto.slice(1, cierre).trim();
  const colones = (interior.match(/:/g) ?? []).length;
  if (colones !== 1 || !/\.md$/.test(interior)) return null;
  return interior;
}

/** @param {string} yml @returns {string[]} errores con línea y motivo */
export function erroresYaml(yml) {
  const errores = [];
  const lineas = String(yml ?? "").split("\n");
  lineas.forEach((linea, i) => {
    const n = i + 1;
    if (/\t/.test(linea)) {
      errores.push(`mkdocs.yml:${n}: tabulador en la indentación (YAML no lo permite)`);
      return;
    }
    const m = linea.match(/^\s*-\s+(.+)$/);
    if (!m) return;
    const resto = m[1].trim();
    if (resto.startsWith('"') || resto.startsWith("'")) {
      const interior = navEnteramenteEntrecomillado(resto);
      if (interior) {
        errores.push(
          `mkdocs.yml:${n}: entrada de nav entrecomillada como un solo valor ("${interior}") — MkDocs la lee como título, no como página; escribila como - "Etiqueta": ruta.md`,
        );
      }
      return; // citado: la etiqueta puede llevar ':'
    }
    if (resto.split(": ").length > 2) {
      errores.push(
        `mkdocs.yml:${n}: el valor del nav tiene más de un ':' ("${resto}") — entrecomillá la etiqueta o reemplazá el ':' por un guion`,
      );
    }
  });
  return errores;
}

/**
 * Valida el front matter de una página: el manifest lo lee con un parser laxo que acepta una lista
 * rota, pero para YAML es inválido un ítem `- x` en columna 0 después de una clave de lista (queda
 * fuera de `sources:`), un tabulador en la indentación o un valor de flujo sin cerrar (`sources: [a`).
 * Normaliza `\r\n` y el BOM antes de analizar. Un front matter que se abre con `---` y no se cierra se
 * reporta (no se omite en silencio).
 * @param {string} txt contenido de la página @param {string} nombre ruta para el mensaje
 * @returns {string[]} errores con línea y motivo
 */
export function erroresFrontMatter(txt, nombre) {
  const norm = txt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^---[ \t]*(\n|$)/.test(norm)) return [];
  const m = norm.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/) ?? norm.match(/^---[ \t]*\n()---[ \t]*(\n|$)/);
  if (!m) return [`${nombre}:1: el front matter se abre con --- y no se cierra: no se puede analizar`];
  const errores = [];
  let enLista = false;
  m[1].split("\n").forEach((l, i) => {
    const n = i + 2; // la línea 1 es el `---` de apertura
    if (/^\t/.test(l)) errores.push(`${nombre}:${n}: tabulador en el front matter`);
    if (/^[A-Za-z_]+:\s*$/.test(l)) enLista = true;
    else if (/^[A-Za-z_]+:/.test(l)) enLista = false;
    else if (/^- /.test(l) && enLista) errores.push(`${nombre}:${n}: ítem de lista en columna 0 dentro del front matter (indentá con dos espacios)`);
    const flujo = l.match(/^[A-Za-z_]+:\s*([[{].*)$/);
    if (flujo) {
      const v = flujo[1];
      const abre = (v.match(/[[{]/g) ?? []).length;
      const cierra = (v.match(/[\]}]/g) ?? []).length;
      if (abre !== cierra) errores.push(`${nombre}:${n}: valor de flujo sin cerrar (${v.trim()})`);
    }
  });
  return errores;
}
