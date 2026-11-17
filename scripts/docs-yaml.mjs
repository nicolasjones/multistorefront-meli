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
export const LARGO_MAXIMO_LINEA = 10000;

/** Cuenta corchetes y llaves fuera de comillas en una sola pasada (O(n); una comilla sin cerrar llega al fin de línea). */
function flujoSinCerrar(v) {
  let abre = 0;
  let cierra = 0;
  let q = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) {
      if (q === '"' && c === "\\") i++;
      else if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") abre++;
    else if (c === "]" || c === "}") cierra++;
  }
  return abre !== cierra;
}

const esLetraClave = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";

export function erroresFrontMatter(txt, nombre) {
  // Sin regex con retroceso: todo el análisis es lineal en el tamaño de la página.
  const norm = txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt;
  const lineas = norm.split(/\r\n?|\n/);
  if (lineas[0].trimEnd() !== "---") return [];
  let cierre = -1;
  for (let j = 1; j < lineas.length; j++) if (lineas[j].trimEnd() === "---") { cierre = j; break; }
  if (cierre < 0) return [`${nombre}:1: el front matter se abre con --- y no se cierra: no se puede analizar`];
  const errores = [];
  let enLista = false;
  for (let j = 1; j < cierre; j++) {
    const l = lineas[j];
    const n = j + 1;
    if (l.length > LARGO_MAXIMO_LINEA) { errores.push(`${nombre}:${n}: línea demasiado larga en el front matter (más de ${LARGO_MAXIMO_LINEA} caracteres)`); continue; }
    if (l[0] === "\t") errores.push(`${nombre}:${n}: tabulador en el front matter`);
    let k = 0;
    while (k < l.length && esLetraClave(l[k])) k++;
    const esClave = k > 0 && l[k] === ":";
    if (esClave) {
      const resto = l.slice(k + 1);
      enLista = resto.trim() === "";
      const v = resto.trimStart();
      if ((v[0] === "[" || v[0] === "{") && flujoSinCerrar(v)) errores.push(`${nombre}:${n}: valor de flujo sin cerrar (${v.trim()})`);
    } else if (l.startsWith("- ") && enLista) errores.push(`${nombre}:${n}: ítem de lista en columna 0 dentro del front matter (indentá con dos espacios)`);
  }
  return errores;
}

export const MAX_TEXTO_ENLACE = 1500;
export const MAX_DESTINO_ENLACE = 300;
export const MAX_TITULO_ENLACE = 1000;
export const MAX_BLANCOS_ENLACE = 1000;
export const MAX_EXCESOS_ENLACE = 50;
const esBlanco = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";

/**
 * Extrae los enlaces `[texto](destino)` y `[texto](destino "título")` de un texto Markdown con un solo recorrido
 * (sin regex con retroceso: una página con miles de `[` sin cerrar no cuelga el control). Los topes son inclusivos
 * (texto hasta 1500, destino hasta 300, título hasta 1000 y hasta 1000 blancos antes del título). Un enlace que excede
 * un tope NO se ignora: se devuelve en `excesos` con su línea para que el control falle cerrado. Se guardan a lo sumo
 * `MAX_EXCESOS_ENLACE` excesos (el resto se cuenta en `masExcesos`).
 * @param {string} txt
 * @returns {{enlaces: Array<{crudo: string, destino: string, linea: number}>, excesos: Array<{linea: number, motivo: string}>, masExcesos: number}}
 */
export function enlacesMarkdown(txt) {
  const enlaces = [];
  const excesos = [];
  let masExcesos = 0;
  const n = txt.length;
  // Contador de líneas monotónico: el costo total de calcular líneas es O(n).
  let posLinea = 0;
  let nLinea = 1;
  const lineaEn = (idx) => {
    for (; posLinea < idx && posLinea < n; posLinea++) if (txt[posLinea] === "\n") nLinea++;
    return nLinea;
  };
  const exceso = (idx, motivo) => {
    if (excesos.length < MAX_EXCESOS_ENLACE) excesos.push({ linea: lineaEn(idx), motivo });
    else masExcesos++;
  };
  let abre = -1;
  for (let i = 0; i < n; i++) {
    const c = txt[i];
    if (c === "[") { abre = i; continue; }
    if (c !== "]") continue;
    const desde = abre;
    abre = -1;
    if (txt[i + 1] !== "(" || desde < 0) continue;
    if (i - desde - 1 > MAX_TEXTO_ENLACE) { exceso(desde, "texto"); continue; }
    const ini = i + 2;
    let j = ini;
    while (j < n && j - ini <= MAX_DESTINO_ENLACE && txt[j] !== ")" && !esBlanco(txt[j])) j++;
    if (j - ini > MAX_DESTINO_ENLACE) { exceso(desde, "destino"); i = j - 1; continue; }
    if (j === ini || j >= n) continue;
    const destino = txt.slice(ini, j);
    if (txt[j] !== ")") {
      let k = j;
      while (k < n && esBlanco(txt[k]) && k - j <= MAX_BLANCOS_ENLACE) k++;
      if (k - j > MAX_BLANCOS_ENLACE) { exceso(desde, "título (blancos antes del título)"); i = k - 1; continue; }
      if (k === j || txt[k] !== '"') continue;
      let f = k + 1;
      while (f < n && f - k - 1 <= MAX_TITULO_ENLACE && txt[f] !== '"') f++;
      if (f - k - 1 > MAX_TITULO_ENLACE) { exceso(desde, "título"); i = f - 1; continue; }
      if (txt[f] !== '"' || txt[f + 1] !== ")") continue;
      j = f + 1;
    }
    enlaces.push({ crudo: txt.slice(desde, j + 1), destino, linea: lineaEn(desde) });
    i = j;
  }
  return { enlaces, excesos, masExcesos };
}
