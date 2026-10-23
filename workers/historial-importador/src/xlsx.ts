// Lector mínimo de `.xlsx` (FR-005) sobre fflate: solo la primera hoja, con textos compartidos,
// textos en línea y números. Un `.xlsx` es un zip con XML; no hay macros ni fórmulas que evaluar.
// Los números se devuelven como texto crudo; las fechas llegan como número de serie y las
// interpreta el normalizador según la columna (sin depender de los estilos del libro).
import { unzipSync, strFromU8 } from 'fflate';
import type { Tabla } from './csv.js';

const MAX_BYTES_DESCOMPRIMIDOS = 200 * 1024 * 1024;

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textoDe(fragmento: string): string {
  let salida = '';
  for (const m of fragmento.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) salida += decodificarEntidades(m[1] ?? '');
  return salida;
}

function textosCompartidos(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1] ?? ''));
}

function columnaDe(referencia: string): number {
  const letras = /^[A-Z]+/.exec(referencia)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rutaPrimeraHoja(archivos: Record<string, Uint8Array>): string {
  const libro = archivos['xl/workbook.xml'];
  const relaciones = archivos['xl/_rels/workbook.xml.rels'];
  if (libro && relaciones) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(strFromU8(libro))?.[1];
    if (rid) {
      for (const m of strFromU8(relaciones).matchAll(/<Relationship\b[^>]*>/g)) {
        const etiqueta = m[0];
        if (new RegExp(`\\bId="${rid}"`).test(etiqueta)) {
          const destino = /\bTarget="([^"]+)"/.exec(etiqueta)?.[1];
          if (destino) return destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
        }
      }
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

export function leerXlsx(bytes: Uint8Array): Tabla {
  let archivos: Record<string, Uint8Array>;
  try {
    archivos = unzipSync(bytes, {
      filter: (f) => f.originalSize <= MAX_BYTES_DESCOMPRIMIDOS && (f.name.startsWith('xl/') || f.name === '[Content_Types].xml'),
    });
  } catch {
    throw new Error('El archivo no es un .xlsx válido');
  }
  const hoja = archivos[rutaPrimeraHoja(archivos)];
  if (!hoja) throw new Error('El .xlsx no tiene hojas');

  const compartidos = textosCompartidos(archivos['xl/sharedStrings.xml'] ? strFromU8(archivos['xl/sharedStrings.xml']) : undefined);
  const xml = strFromU8(hoja);
  const filas: Tabla = [];

  for (const filaXml of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const celdas: string[] = [];
    for (const c of (filaXml[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1] ?? '';
      const cuerpo = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1];
      const indice = ref ? columnaDe(ref) : celdas.length;
      let valor = '';
      if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? '';
        if (tipo === 's') valor = compartidos[Number(v)] ?? '';
        else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
        else valor = decodificarEntidades(v);
      }
      while (celdas.length < indice) celdas.push('');
      celdas[indice] = valor;
    }
    filas.push(celdas);
  }
  return filas;
}

export function esXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
