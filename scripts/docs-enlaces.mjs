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
 * Vacía los bloques de código conservando los saltos de línea (los números de línea siguen siendo los del archivo).
 * @returns {{texto: string, sinCerrar: number[]}} `sinCerrar`: líneas de los fences que no se cierran
 */
export function enmascararCodigo(txt) {
  const n = txt.length;
  const salida = [];
  let pos = 0;
  let nLinea = 0;
  let abierto = null;
  while (pos <= n) {
    let fin = txt.indexOf("\n", pos);
    if (fin < 0) fin = n;
    nLinea++;
    const linea = txt.slice(pos, fin);
    let k = 0;
    while (k < linea.length && (linea[k] === " " || linea[k] === "\t" || linea[k] === ">")) k++;
    const ch = linea[k];
    let r = k;
    if (ch === "`" || ch === "~") while (r < linea.length && linea[r] === ch) r++;
    const run = r - k;
    if (!abierto) {
      if (run >= 3 && !(ch === "`" && linea.indexOf("`", r) >= 0)) { abierto = { ch, run, linea: nLinea }; salida.push(""); }
      else salida.push(linea);
    } else {
      if (run >= abierto.run && ch === abierto.ch && linea.slice(r).trim() === "") abierto = null;
      salida.push("");
    }
    pos = fin + 1;
  }
  return { texto: salida.join("\n"), sinCerrar: abierto ? [abierto.linea] : [] };
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
export function enlacesMarkdown(original) {
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
  const leerDestino = (j, linea, enDefinicion) => {
    if (txt[j] === "<") {
      const ds = j + 1;
      let e = ds;
      while (e < n && e - ds <= MAX_DESTINO_ENLACE && txt[e] !== ">" && txt[e] !== "\n") e++;
      if (e - ds > MAX_DESTINO_ENLACE) { exceso(linea, "destino"); return { fin: e, excedido: true }; }
      if (txt[e] !== ">" || e === ds) return null;
      return { destino: txt.slice(ds, e), fin: e + 1 };
    }
    const ds = j;
    while (j < n && j - ds <= MAX_DESTINO_ENLACE && txt[j] !== ")" && !esBlanco(txt[j])) j++;
    if (j - ds > MAX_DESTINO_ENLACE) { exceso(linea, "destino"); return { fin: j, excedido: true }; }
    if (j === ds || (enDefinicion === false && j >= n)) return null;
    return { destino: txt.slice(ds, j), fin: j };
  };
  const leerTitulo = (k, linea) => {
    const q = txt[k];
    if (q !== '"' && q !== "'") return null;
    let f = k + 1;
    while (f < n && f - k - 1 <= MAX_TITULO_ENLACE && txt[f] !== q) f++;
    if (f - k - 1 > MAX_TITULO_ENLACE) { exceso(linea, "título"); return { excedido: true, fin: f }; }
    if (txt[f] !== q) return null;
    return { fin: f + 1 };
  };

  const pilaPos = [];
  const pilaLinea = [];
  for (let i = 0; i < n; i++) {
    const c = txt[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") { pilaPos.push(i); pilaLinea.push(lineaEn(i)); continue; }
    if (c === "<") { i = etiquetaHtml(i); continue; }
    if (c !== "]" || pilaPos.length === 0) continue;
    const desde = pilaPos.pop();
    const linea = pilaLinea.pop();
    const sig = txt[i + 1];
    if (sig === "(") {
      if (i - desde - 1 > MAX_TEXTO_ENLACE) { exceso(linea, "texto"); continue; }
      let j = saltarBlancos(i + 2, "destino (blancos antes del destino)", linea);
      if (j < 0) { continue; }
      const d = leerDestino(j, linea, false);
      if (!d) continue;
      if (d.excedido) { i = d.fin - 1; continue; }
      j = d.fin;
      const k = saltarBlancos(j, "título (blancos antes del título)", linea);
      if (k < 0) { i = j; continue; }
      if (txt[k] === ")") { enlaces.push({ crudo: txt.slice(desde, k + 1), destino: d.destino, linea }); i = k; continue; }
      if (k === j) continue;
      const t = leerTitulo(k, linea);
      if (!t) continue;
      if (t.excedido) { i = t.fin - 1; continue; }
      const f = saltarBlancos(t.fin, "título (blancos después del título)", linea);
      if (f < 0 || txt[f] !== ")") continue;
      enlaces.push({ crudo: txt.slice(desde, f + 1), destino: d.destino, linea });
      i = f;
    } else if (sig === ":" && txt[desde + 1] !== "^") {
      // Definición de referencia `[x]: destino "título"` (solo al inicio de línea y con nada más en la línea).
      let b = desde - 1;
      while (b >= 0 && txt[b] === " ") b--;
      if (!(b < 0 || txt[b] === "\n") || desde - b - 1 > 3) continue;
      let j = i + 2;
      const ini = j;
      while (j < n && (txt[j] === " " || txt[j] === "\t") && j - ini <= MAX_BLANCOS_ENLACE) j++;
      const d = leerDestino(j, linea, true);
      if (!d) continue;
      if (d.excedido) { i = d.fin - 1; continue; }
      j = d.fin;
      while (j < n && (txt[j] === " " || txt[j] === "\t") && j - d.fin <= MAX_BLANCOS_ENLACE) j++;
      if (j < n && txt[j] !== "\n") {
        const t = leerTitulo(j, linea);
        if (!t) continue;
        if (t.excedido) { i = t.fin - 1; continue; }
        j = t.fin;
        while (j < n && (txt[j] === " " || txt[j] === "\t") && j - t.fin <= MAX_BLANCOS_ENLACE) j++;
        if (j < n && txt[j] !== "\n") continue;
      }
      enlaces.push({ crudo: txt.slice(desde, j), destino: d.destino, linea });
      i = j;
    }
  }

  // `<a href="…">` y `<img src="…">`: devuelve el índice del último carácter consumido.
  function etiquetaHtml(i) {
    let p = i + 1;
    const esA = (txt[p] === "a" || txt[p] === "A") && p + 1 < n && (esBlanco(txt[p + 1]));
    const esImg = !esA && empiezaCI(txt, p, "img") && p + 3 < n && esBlanco(txt[p + 3]);
    if (!esA && !esImg) return i;
    const attr = esA ? "href" : "src";
    let e = i + 1;
    while (e < n && e - i <= MAX_ETIQUETA_HTML && txt[e] !== ">") e++;
    if (e - i > MAX_ETIQUETA_HTML) { exceso(lineaEn(i), "etiqueta HTML"); return e - 1; }
    const linea = lineaEn(i);
    for (p = i + 2; p < e; p++) {
      if (!esBlanco(txt[p - 1]) || !empiezaCI(txt, p, attr)) continue;
      let q = p + attr.length;
      while (q < e && esBlanco(txt[q])) q++;
      if (txt[q] !== "=") continue;
      q++;
      while (q < e && esBlanco(txt[q])) q++;
      const comilla = txt[q] === '"' || txt[q] === "'" ? txt[q] : "";
      if (comilla) q++;
      let v = q;
      while (v < e && txt[v] !== comilla && (comilla || !esBlanco(txt[v]))) v++;
      if (comilla && txt[v] !== comilla) break;
      if (v - q > MAX_DESTINO_ENLACE) { exceso(linea, "destino"); break; }
      if (v > q) enlaces.push({ crudo: txt.slice(i, e + 1), destino: txt.slice(q, v), linea });
      break;
    }
    return e;
  }

  return { enlaces, excesos, masExcesos, sinCerrar };
}
