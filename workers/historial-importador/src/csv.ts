// Lector de CSV (FR-005): detecta codificación (UTF-8 con o sin BOM, UTF-16 con BOM, o Latin-1) y
// separador (`,`, `;` o tabulador) y parte el texto en celdas respetando comillas (RFC 4180).

export type Tabla = string[][];

/** Decodifica los bytes: BOM primero; si no hay, UTF-8 estricto y, si falla, Latin-1. */
export function decodificarTexto(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** Elige el separador que más aparece fuera de comillas en la primera línea no vacía. */
export function detectarSeparador(texto: string): string {
  const candidatos = [',', ';', '\t'];
  const cuentas = new Map(candidatos.map((c) => [c, 0]));
  let enComillas = false;
  let vistoAlgo = false;
  for (const ch of texto) {
    if (ch === '"') {
      enComillas = !enComillas;
      vistoAlgo = true;
    } else if (!enComillas && (ch === '\n' || ch === '\r')) {
      if (vistoAlgo) break;
    } else if (!enComillas) {
      vistoAlgo = true;
      if (cuentas.has(ch)) cuentas.set(ch, (cuentas.get(ch) ?? 0) + 1);
    } else {
      vistoAlgo = true;
    }
  }
  let mejor = ',';
  let max = 0;
  for (const c of candidatos) {
    const n = cuentas.get(c) ?? 0;
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

/** Parte el texto en filas de celdas. Las filas totalmente vacías se conservan (el validador las salta). */
export function parsearCsv(texto: string, separador: string = detectarSeparador(texto)): Tabla {
  const filas: Tabla = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;
  let hayContenido = false;

  const cerrarCelda = () => {
    fila.push(celda);
    celda = '';
  };
  const cerrarFila = () => {
    cerrarCelda();
    filas.push(fila);
    fila = [];
    hayContenido = false;
  };

  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i] as string;
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          enComillas = false;
        }
      } else {
        celda += ch;
      }
      continue;
    }
    if (ch === '"' && celda === '') {
      enComillas = true;
      hayContenido = true;
    } else if (ch === separador) {
      cerrarCelda();
      hayContenido = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && texto[i + 1] === '\n') i += 1;
      if (hayContenido || celda !== '' || fila.length > 0) cerrarFila();
    } else {
      celda += ch;
      hayContenido = true;
    }
  }
  if (hayContenido || celda !== '' || fila.length > 0) cerrarFila();
  return filas;
}

export function leerCsv(bytes: Uint8Array): Tabla {
  return parsearCsv(decodificarTexto(bytes));
}
