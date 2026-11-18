// Extractor de enlaces de Markdown para `docs-check`: un solo recorrido, sin regex con retroceso (una página
// hostil no puede colgar el control) y que falla cerrado: lo que no puede validar se reporta, no se ignora.
//
// Cubre: `[texto](destino "título")` (también anidado, p. ej. imagen dentro de un enlace), `<destino con espacios>`,
// definiciones de referencia `[x]: destino`, `<a href="…">` y `<img src="…">`. Los bloques de código (fences de
// CommonMark: abre con ≥3 backticks o tildes y cierra solo con el mismo carácter y ≥ la longitud) no se analizan; un
// fence sin cerrar se reporta.

export const MAX_TEXTO_ENLACE = 1500;
export const MAX_DESTINO_ENLACE = 300;
export const MAX_TITULO_ENLACE = 1000;
export const MAX_BLANCOS_ENLACE = 1000;
export const MAX_ETIQUETA_HTML = 1000;
export const MAX_EXCESOS_ENLACE = 50;

// Misma definición que `/\s/` de JavaScript.
export function esBlanco(c) {
  const k = c.charCodeAt(0);
  if (k <= 32) return k === 32 || (k >= 9 && k <= 13);
  return k === 0xa0 || k === 0x1680 || (k >= 0x2000 && k <= 0x200a) || k === 0x2028 || k === 0x2029 || k === 0x202f || k === 0x205f || k === 0x3000 || k === 0xfeff;
}

/**
 * Prefijo de contenedor de una línea: marcas de cita (`>`), sangría y marcadores de lista (`- `, `1. `), también anidados.
 * Devuelve la profundidad de cita, la columna donde empieza el contenido, el índice de ese contenido, la columna de contenido
 * de la última lista (0 si no hubo marcador) y si la línea queda vacía.
 */
function prefijoDeContenedor(linea) {
  const len = linea.length;
  let k = 0;
  let col = 0;
  let depth = 0;
  let listaCol = 0;
  for (;;) {
    while (k < len) {
      const c = linea[k];
      if (c === " ") { col++; k++; }
      else if (c === "\t") { col += 4 - (col % 4); k++; }
      else if (c === ">") { depth++; col++; k++; }
      else break;
    }
    let m = 0;
    const c = linea[k];
    if ((c === "-" || c === "*" || c === "+") && (k + 1 >= len || linea[k + 1] === " " || linea[k + 1] === "\t")) m = 1;
    else if (c >= "0" && c <= "9") {
      let d = k;
      while (d < len && d - k < 9 && linea[d] >= "0" && linea[d] <= "9") d++;
      if ((linea[d] === "." || linea[d] === ")") && (d + 1 >= len || linea[d + 1] === " " || linea[d + 1] === "\t")) m = d + 1 - k;
    }
    if (!m) break;
    k += m;
    col += m;
    while (k < len && (linea[k] === " " || linea[k] === "\t")) { col += linea[k] === "\t" ? 4 - (col % 4) : 1; k++; }
    listaCol = col;
    if (k >= len) break;
  }
  return { depth, col, k, listaCol, vacia: linea.slice(k).trim() === "" };
}

/**
 * Vacía los bloques de código conservando los saltos de línea (los números de línea siguen siendo los del archivo).
 * Un fence se abre con ≥3 backticks o tildes y se cierra solo con el mismo carácter, longitud ≥ la de apertura y dentro del
 * mismo contenedor (cita o ítem de lista) de la línea de apertura; si el contenedor termina antes, el bloque queda sin cerrar.
 * @returns {{texto: string, sinCerrar: number[]}} `sinCerrar`: líneas de los fences que no se cierran
 */
export function enmascararCodigo(txt) {
  const n = txt.length;
  const salida = [];
  const sinCerrar = [];
  let pos = 0;
  let nLinea = 0;
  let abierto = null;
  while (pos <= n) {
    let fin = txt.indexOf("\n", pos);
    if (fin < 0) fin = n;
    nLinea++;
    const linea = txt.slice(pos, fin);
    pos = fin + 1;
    const p = prefijoDeContenedor(linea);
    if (abierto && !p.vacia && (p.depth < abierto.depth || (abierto.ind > 0 && p.col < abierto.ind))) {
      sinCerrar.push(abierto.linea); // el contenedor terminó sin cerrar el fence: esta línea ya no es código
      abierto = null;
    }
    const ch = linea[p.k];
    let r = p.k;
    if (ch === "`" || ch === "~") while (r < linea.length && linea[r] === ch) r++;
    const run = r - p.k;
    if (!abierto) {
      if (run >= 3 && !(ch === "`" && linea.indexOf("`", r) >= 0)) {
        abierto = { ch, run, linea: nLinea, depth: p.depth, ind: p.listaCol > 0 ? p.listaCol : p.col >= 2 ? p.col : 0 };
        salida.push("");
      } else salida.push(linea);
    } else {
      if (run >= abierto.run && ch === abierto.ch && linea.slice(r).trim() === "") abierto = null;
      salida.push("");
    }
  }
  if (abierto) sinCerrar.push(abierto.linea);
  return { texto: salida.join("\n"), sinCerrar };
}

const minus = (c) => c.charCodeAt(0) | 32;
const empiezaCI = (s, p, palabra) => {
  for (let i = 0; i < palabra.length; i++) if (p + i >= s.length || minus(s[p + i]) !== palabra.charCodeAt(i)) return false;
  return true;
};

/**
 * @param {string} original contenido del archivo
 * @returns {{enlaces: Array<{crudo: string, destino: string, linea: number}>, excesos: Array<{linea: number, motivo: string}>, masExcesos: number, sinCerrar: number[]}}
 */
export function enlacesMarkdown(crudo) {
  // BOM y finales de línea CRLF/CR normalizados a `\n` antes de analizar (las líneas se cuentan igual que en un editor).
  const original = (crudo.charCodeAt(0) === 0xfeff ? crudo.slice(1) : crudo).replace(/\r\n?/g, "\n");
  const { texto: txt, sinCerrar } = enmascararCodigo(original);
  const n = txt.length;
  const enlaces = [];
  const excesos = [];
  let masExcesos = 0;
  let posLinea = 0;
  let nLinea = 1;
  const lineaEn = (idx) => {
    for (; posLinea < idx && posLinea < n; posLinea++) if (txt[posLinea] === "\n") nLinea++;
    return nLinea;
  };
  const exceso = (linea, motivo) => {
    if (excesos.length < MAX_EXCESOS_ENLACE) excesos.push({ linea, motivo });
    else masExcesos++;
  };
  const saltarBlancos = (j, motivo, linea) => {
    const ini = j;
    while (j < n && esBlanco(txt[j]) && j - ini <= MAX_BLANCOS_ENLACE) j++;
    if (j - ini > MAX_BLANCOS_ENLACE) { exceso(linea, motivo); return -1; }
    return j;
  };
  // Destino desde `j`: `<…>` (admite espacios) o hasta el primer blanco o `)`. Devuelve {destino, fin} o null (excedido: ya reportado).
  const leerDestino = (j, linea, enDefinicion, plano = false) => {
    if (txt[j] === "<" && !plano) {
      const ds = j + 1;
      let e = ds;
      while (e < n && e - ds <= MAX_DESTINO_ENLACE && txt[e] !== ">" && txt[e] !== "\n") e++;
      if (e - ds > MAX_DESTINO_ENLACE) { exceso(linea, "destino"); return { fin: e, excedido: true }; }
      if (txt[e] === ">" && e > ds) return { destino: txt.slice(ds, e), fin: e + 1 };
      // `<` sin `>` de cierre: se lee como destino común (así no se pierde un enlace roto como `[a](<x.md)`).
    }
    const ds = j;
    while (j < n && j - ds <= MAX_DESTINO_ENLACE && txt[j] !== ")" && !esBlanco(txt[j])) j++;
    if (j - ds > MAX_DESTINO_ENLACE) { exceso(linea, "destino"); return { fin: j, excedido: true }; }
    if (j === ds || (enDefinicion === false && j >= n)) return null;
    return { destino: txt.slice(ds, j), fin: j };
  };
  const leerTitulo = (k, linea) => {
    const abre = txt[k];
    if (abre !== '"' && abre !== "'" && abre !== "(") return null;
    const q = abre === "(" ? ")" : abre;
    let f = k + 1;
    while (f < n && f - k - 1 <= MAX_TITULO_ENLACE && txt[f] !== q) f++;
    if (f - k - 1 > MAX_TITULO_ENLACE) { exceso(linea, "título"); return { excedido: true, fin: f }; }
    if (txt[f] !== q) return null;
    return { fin: f + 1 };
  };

  const enlaceEnLinea = (desde, j0, linea, plano) => {
    const d = leerDestino(j0, linea, false, plano);
    if (!d || d.excedido) return false;
    const j = d.fin;
    const k = saltarBlancos(j, "título (blancos antes del título)", linea);
    if (k < 0) return false;
    if (txt[k] === ")") { enlaces.push({ crudo: txt.slice(desde, k + 1), destino: d.destino, linea }); return true; }
    if (k === j) return false;
    const tt = leerTitulo(k, linea);
    if (!tt || tt.excedido) return false;
    const f = saltarBlancos(tt.fin, "título (blancos después del título)", linea);
    if (f < 0 || txt[f] !== ")") return false;
    enlaces.push({ crudo: txt.slice(desde, f + 1), destino: d.destino, linea });
    return true;
  };

  const pilaPos = [];
  const pilaLinea = [];
  for (let i = 0; i < n; i++) {
    const c = txt[i];
    if (c === "[") { pilaPos.push(i); pilaLinea.push(lineaEn(i)); continue; }
    if (c === "<") { etiquetaHtml(i); continue; }
    if (c !== "]" || pilaPos.length === 0) continue;
    const desde = pilaPos.pop();
    const linea = pilaLinea.pop();
    const sig = txt[i + 1];
    if (sig === "(") {
      if (i - desde - 1 > MAX_TEXTO_ENLACE) { exceso(linea, "texto"); continue; }
      const j0 = saltarBlancos(i + 2, "destino (blancos antes del destino)", linea);
      if (j0 < 0) continue;
      // Destino entre `<…>` primero; si no forma un enlace, se reintenta como destino común (no se pierde `[a](<x.md)`).
      if (txt[j0] === "<") {
        const antes = enlaces.length;
        const ok = enlaceEnLinea(desde, j0, linea, false);
        // Además, la lectura como destino común (la del extractor anterior), si forma otro enlace distinto.
        const previo = ok ? enlaces[antes].destino : null;
        const n0 = enlaces.length;
        if (enlaceEnLinea(desde, j0, linea, true) && previo !== null && enlaces[n0].destino.replace(/^<|>$/g, "") === previo) enlaces.pop();
      } else enlaceEnLinea(desde, j0, linea, false);
    } else if (sig === ":" && txt[desde + 1] !== "^") {
      // Definición de referencia `[x]: destino "título"`: al inicio de un bloque (también dentro de una cita o un ítem de
      // lista), con el destino en la misma línea o en la siguiente y un título opcional (también en la línea siguiente).
      if (!inicioDeBloque(desde)) continue;
      const blancos = (j) => { const ini = j; while (j < n && (txt[j] === " " || txt[j] === "\t") && j - ini <= MAX_BLANCOS_ENLACE) j++; return j; };
      const siguienteLinea = (j) => { j++; while (j < n && (txt[j] === " " || txt[j] === "\t" || txt[j] === ">") && j < i + 4 * MAX_BLANCOS_ENLACE) j++; return j; };
      let j = blancos(i + 2);
      if (j < n && txt[j] === "\n") j = blancos(siguienteLinea(j));
      const d = leerDestino(j, linea, true);
      if (!d) continue;
      if (d.excedido) { continue; }
      j = blancos(d.fin);
      let fin = j;
      if (j < n && txt[j] !== "\n") {
        const tt = leerTitulo(j, linea);
        if (!tt) continue;
        if (tt.excedido) { continue; }
        fin = blancos(tt.fin);
        if (fin < n && txt[fin] !== "\n") continue;
      } else if (j < n) {
        // Título opcional en la línea siguiente (solo cuenta si ocupa la línea entera).
        const k = blancos(siguienteLinea(j));
        const tt = k < n && txt[k] !== "\n" ? leerTitulo(k, linea) : null;
        if (tt && !tt.excedido) {
          const f2 = blancos(tt.fin);
          if (f2 >= n || txt[f2] === "\n") fin = f2;
        }
      }
      enlaces.push({ crudo: txt.slice(desde, fin), destino: d.destino, linea });
    }
  }

  // ¿`[` está al inicio de un bloque? Solo precedido por sangría, marcas de cita y marcadores de lista en su línea.
  function inicioDeBloque(desde) {
    let b = desde - 1;
    const tope = Math.max(-1, desde - 200);
    while (b > tope) {
      const c = txt[b];
      if (c === " " || c === "\t" || c === ">") { b--; continue; }
      if (c === "\n") return true;
      // marcador de lista: `-`, `*`, `+` o número seguido de `.` o `)`; debe tener un blanco o el inicio de línea antes
      let m = b;
      if (c === "-" || c === "*" || c === "+") m = b;
      else if (c === "." || c === ")") { m = b - 1; if (!(txt[m] >= "0" && txt[m] <= "9")) return false; while (m > tope && txt[m - 1] >= "0" && txt[m - 1] <= "9") m--; }
      else return false;
      const antes = txt[m - 1];
      if (m - 1 <= tope && m > 0) return false;
      if (m === 0 || antes === " " || antes === "\t" || antes === ">" || antes === "\n") { b = m - 1; if (b < 0) return true; continue; }
      return false;
    }
    return b < 0;
  }

  // `<a href="…">` y `<img src="…">`: registra el destino y NO consume nada (el resto de la etiqueta se sigue analizando como
  // texto, así que un enlace en línea dentro de una etiqueta rara tampoco se oculta). Respeta las comillas de los atributos.
  function etiquetaHtml(i) {
    const p = i + 1;
    const esA = (txt[p] === "a" || txt[p] === "A") && p + 1 < n && esBlanco(txt[p + 1]);
    const esImg = !esA && empiezaCI(txt, p, "img") && p + 3 < n && esBlanco(txt[p + 3]);
    if (!esA && !esImg) return;
    const attr = esA ? "href" : "src";
    const limite = Math.min(n, i + MAX_ETIQUETA_HTML + 1);
    let q = p + (esA ? 1 : 3);
    while (q < limite) {
      while (q < limite && esBlanco(txt[q])) q++;
      if (q >= limite) return;
      const c = txt[q];
      if (c === ">" || c === "<") return;
      const ini = q;
      while (q < limite && !esBlanco(txt[q]) && "=>/\"'<".indexOf(txt[q]) < 0) q++;
      if (q === ini) { q++; continue; }
      const nombre = txt.slice(ini, q);
      while (q < limite && esBlanco(txt[q])) q++;
      if (txt[q] !== "=") continue;
      q++;
      while (q < limite && esBlanco(txt[q])) q++;
      const comilla = txt[q] === '"' || txt[q] === "'" ? txt[q] : "";
      if (comilla) q++;
      const vs = q;
      while (q < limite && txt[q] !== comilla && (comilla || (!esBlanco(txt[q]) && txt[q] !== ">"))) q++;
      if (comilla && txt[q] !== comilla) return;
      const valor = txt.slice(vs, q);
      if (comilla) q++;
      if (nombre.length === attr.length && empiezaCI(nombre, 0, attr)) {
        if (valor.length > MAX_DESTINO_ENLACE) exceso(lineaEn(i), "destino");
        else if (valor) enlaces.push({ crudo: txt.slice(i, q), destino: valor, linea: lineaEn(i) });
        return;
      }
    }
  }

  return { enlaces, excesos, masExcesos, sinCerrar };
}
