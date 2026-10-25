// Errores de YAML que rompen el build estricto de MkDocs.
//
// El agente (Documentador) edita `mkdocs.yml` para agregar páginas al nav y a veces escribe
// un valor con dos ':' ("- Stock: lotes e inventario: producto/stock-lotes.md"): YAML responde
// "mapping values are not allowed here" y el PR de docs queda rojo en CI sin que se note el motivo.
//
// Esto es determinista y sin dependencias: no hace falta un parser YAML completo, sólo se
// detectan los dos patrones que el agente produce (doble ':' y tabuladores).

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
    if (resto.startsWith('"') || resto.startsWith("'")) return; // citado: puede llevar ':'
    if (resto.split(": ").length > 2) {
      errores.push(
        `mkdocs.yml:${n}: el valor del nav tiene más de un ':' ("${resto}") — entrecomillá el valor o reemplazá el ':' por un guion`,
      );
    }
  });
  return errores;
}
