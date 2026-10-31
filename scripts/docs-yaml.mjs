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
