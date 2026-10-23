import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodificarTexto, detectarSeparador } from '../src/csv.js';
import { importarArchivo, TAMANO_LOTE, type ConteoLote, type InsertarLote } from '../src/importar.js';
import { validarEntrada } from '../src/entrada.js';
import { normalizarFecha, normalizarImporte } from '../src/normalizar.js';
import type { FilaImportable } from '../src/validar.js';

const EMPRESAS = [
  { id: '11111111-1111-4111-8111-111111111111', nombre: 'Tienda Centro' },
  { id: '22222222-2222-4222-8222-222222222222', nombre: 'Tienda Norte' },
];

/** Inserción en memoria con la misma clave natural que la base (on conflict do nothing). */
function baseEnMemoria(clave: (f: FilaImportable) => string) {
  const vistas = new Set<string>();
  const lotes: number[] = [];
  const insertar: InsertarLote = async (filas): Promise<ConteoLote> => {
    lotes.push(filas.length);
    let nuevas = 0;
    for (const f of filas) {
      const k = clave(f);
      if (!vistas.has(k)) {
        vistas.add(k);
        nuevas += 1;
      }
    }
    return { nuevas, existentes: filas.length - nuevas };
  };
  return { insertar, vistas, lotes };
}

const claveComprobante = (f: FilaImportable) => `${f.empresa_id}|${f.numero}`;

const CSV_COMPROBANTES = [
  'Comprobante;Tienda;Fecha;Cliente;N.º de cliente;Operador;Estado final;Total',
  '0001-00000123;Tienda Centro;05/03/2024;Ana Pérez;44;Luis;Cobrado;"1.234,50"',
  '0001-00000124;Tienda Norte;2024-03-06;Bruno Díaz;;Luis;Pendiente;412.300',
].join('\r\n');

const CSV_COBROS = [
  'Fecha,Comprobante,Tienda,Cliente,Cuenta de cobro,Aprobado por,Importe',
  '05/03/2024,0001-00000123,Tienda Centro,Ana Pérez,Caja,María,"1234.50"',
].join('\n');

const CSV_COTIZACIONES = ['Fecha\tDólar comprador\tDólar vendedor\tCargó', '05/03/2024\t980,5\t1010\tLuis'].join('\n');

function xlsx(filas: string[][]): Uint8Array {
  const columna = (i: number) => String.fromCharCode(65 + i);
  const celdas = filas
    .map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => `<c r="${columna(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${celdas}</sheetData></worksheet>`),
  });
}

describe('importación válida', () => {
  it('importa un CSV de comprobantes (separador ;, importes con coma y miles)', async () => {
    const db = baseEnMemoria(claveComprobante);
    const r = await importarArchivo('comprobantes', strToU8(CSV_COMPROBANTES), EMPRESAS, db.insertar);
    expect(r).toEqual({ estado: 'exitosa', nuevas: 2, existentes: 0, total: 2 });
  });

  it('importa un CSV de cobros (separador ,)', async () => {
    const db = baseEnMemoria((f) => `${f.empresa_id}|${f.comprobante_numero}|${f.fecha}|${f.importe}`);
    const r = await importarArchivo('cobros', strToU8(CSV_COBROS), EMPRESAS, db.insertar);
    expect(r).toMatchObject({ estado: 'exitosa', nuevas: 1 });
  });

  it('importa un CSV de cotizaciones (tabulador) sin tienda', async () => {
    const filas: FilaImportable[] = [];
    const r = await importarArchivo('cotizaciones', strToU8(CSV_COTIZACIONES), [], async (lote) => {
      filas.push(...lote);
      return { nuevas: lote.length, existentes: 0 };
    });
    expect(r).toMatchObject({ estado: 'exitosa', nuevas: 1 });
    expect(filas[0]).toMatchObject({ fecha: '2024-03-05', dolar_comprador: '980.50', dolar_vendedor: '1010.00' });
  });

  it('importa un Excel (.xlsx) de cada tipo', async () => {
    const comp = xlsx([
      ['Comprobante', 'Tienda', 'Fecha', 'Cliente', 'Estado final', 'Total'],
      ['0001-00000200', 'Tienda Centro', '45356', 'Ana Pérez', 'Cobrado', '1500'],
    ]);
    const cob = xlsx([
      ['Fecha', 'Comprobante', 'Tienda', 'Cliente', 'Cuenta de cobro', 'Importe'],
      ['06/03/2024', '0001-00000200', 'Tienda Norte', 'Ana Pérez', 'Banco', '1500'],
    ]);
    const cot = xlsx([
      ['Fecha', 'Dólar comprador', 'Dólar vendedor'],
      ['06/03/2024', '981', '1011'],
    ]);
    const filas: FilaImportable[] = [];
    const guardar: InsertarLote = async (l) => {
      filas.push(...l);
      return { nuevas: l.length, existentes: 0 };
    };
    expect(await importarArchivo('comprobantes', comp, EMPRESAS, guardar)).toMatchObject({ estado: 'exitosa', total: 1 });
    expect(filas[0]).toMatchObject({ fecha: '2024-03-05', total: '1500.00' }); // 45356 = 2024-03-05 en Excel
    expect(await importarArchivo('cobros', cob, EMPRESAS, guardar)).toMatchObject({ estado: 'exitosa', total: 1 });
    expect(await importarArchivo('cotizaciones', cot, [], guardar)).toMatchObject({ estado: 'exitosa', total: 1 });
  });

  it('inserta por lotes de TAMANO_LOTE filas', async () => {
    const cuerpo = Array.from({ length: TAMANO_LOTE + 5 }, (_, i) => `2024-01-01;${i};${i}.00`);
    const csv = ['Fecha;Dólar comprador;Dólar vendedor', ...cuerpo.map((l, i) => `01/01/${2000 + (i % 90)};${i + 1};${i + 2}`)].join('\n');
    const db = baseEnMemoria((f) => String(f.fecha) + String(f.dolar_comprador));
    const r = await importarArchivo('cotizaciones', strToU8(csv), [], db.insertar);
    expect(r.estado).toBe('exitosa');
    expect(db.lotes).toEqual([TAMANO_LOTE, 5]);
  });
});

describe('codificación, separador, fechas e importes', () => {
  it('decodifica UTF-8 con BOM, UTF-16 y Latin-1', () => {
    expect(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, 0x43, 0xc3, 0xb3]))).toBe('Có');
    expect(decodificarTexto(new Uint8Array([0xff, 0xfe, 0x43, 0x00, 0xf3, 0x00]))).toBe('Có');
    expect(decodificarTexto(new Uint8Array([0x43, 0xf3]))).toBe('Có'); // Latin-1: UTF-8 estricto falla
  });

  it('detecta el separador fuera de comillas', () => {
    expect(detectarSeparador('a;b;c')).toBe(';');
    expect(detectarSeparador('a\tb\tc')).toBe('\t');
    expect(detectarSeparador('"a;b;c",d')).toBe(',');
  });

  it('normaliza fechas dd/mm/aaaa, ISO y rechaza las imposibles', () => {
    expect(normalizarFecha('05/03/2024')).toBe('2024-03-05');
    expect(normalizarFecha('2024-03-05 10:00')).toBe('2024-03-05');
    expect(normalizarFecha('31/02/2024')).toBeNull();
    expect(normalizarFecha('mañana')).toBeNull();
  });

  it('normaliza importes con coma o punto, miles y signo', () => {
    expect(normalizarImporte('1.234,50')).toBe('1234.50');
    expect(normalizarImporte('1,234.50')).toBe('1234.50');
    expect(normalizarImporte('412.300')).toBe('412300.00');
    expect(normalizarImporte('$ 99,5')).toBe('99.50');
    expect(normalizarImporte('-10')).toBe('-10.00');
    expect(normalizarImporte('abc')).toBeNull();
  });
});

describe('rechazo todo-o-nada', () => {
  it('no escribe nada si una sola fila es inválida y informa fila, columna y motivo', async () => {
    const csv = `${CSV_COMPROBANTES}\r\n0001-00000125;Tienda Fantasma;31/02/2024;Eva;;;Cobrado;abc`;
    const db = baseEnMemoria(claveComprobante);
    const r = await importarArchivo('comprobantes', strToU8(csv), EMPRESAS, db.insertar);
    expect(r.estado).toBe('fallida');
    if (r.estado !== 'fallida') return;
    expect(r.motivo).toBe('ARCHIVO_INVALIDO');
    expect(r.rechazos).toEqual(
      expect.arrayContaining([
        { fila: 4, columna: 'Tienda', motivo: 'La tienda no existe en la organización' },
        { fila: 4, columna: 'Fecha', motivo: expect.stringContaining('Fecha ilegible') },
        { fila: 4, columna: 'Total', motivo: 'Importe no numérico' },
      ]),
    );
    expect(db.lotes).toEqual([]); // ni siquiera las filas válidas se escribieron
  });

  it('los motivos no repiten el contenido de las celdas (sin datos sensibles)', async () => {
    const csv = 'Comprobante;Tienda;Fecha;Cliente;Estado final;Total\nSECRETO-123;Tienda Centro;fecha-secreta;Cli;Ok;monto-secreto';
    const r = await importarArchivo('comprobantes', strToU8(csv), EMPRESAS, async () => ({ nuevas: 0, existentes: 0 }));
    expect(JSON.stringify(r)).not.toMatch(/secreto|SECRETO/i);
  });

  it('rechaza si falta una columna obligatoria, el archivo está vacío o no es legible', async () => {
    const sinTotal = 'Comprobante;Tienda;Fecha;Cliente;Estado final\nx;Tienda Centro;01/01/2024;c;ok';
    const nada: InsertarLote = async () => ({ nuevas: 0, existentes: 0 });
    const a = await importarArchivo('comprobantes', strToU8(sinTotal), EMPRESAS, nada);
    expect(a).toMatchObject({ estado: 'fallida', rechazos: [{ columna: 'Total', motivo: 'Falta la columna obligatoria' }] });
    expect(await importarArchivo('cobros', strToU8(''), EMPRESAS, nada)).toMatchObject({ estado: 'fallida' });
    const zipRoto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    expect(await importarArchivo('cobros', zipRoto, EMPRESAS, nada)).toMatchObject({ estado: 'fallida', motivo: 'ARCHIVO_ILEGIBLE' });
  });
});

describe('idempotencia', () => {
  it('reimportar el mismo archivo no duplica: todo queda como existente', async () => {
    const db = baseEnMemoria(claveComprobante);
    const primera = await importarArchivo('comprobantes', strToU8(CSV_COMPROBANTES), EMPRESAS, db.insertar);
    const segunda = await importarArchivo('comprobantes', strToU8(CSV_COMPROBANTES), EMPRESAS, db.insertar);
    expect(primera).toMatchObject({ nuevas: 2, existentes: 0 });
    expect(segunda).toMatchObject({ nuevas: 0, existentes: 2 });
    expect(db.vistas.size).toBe(2);
  });
});

describe('entrada del worker (contrato)', () => {
  const UUID = '11111111-1111-4111-8111-111111111111';
  it('acepta organización y ejecución válidas', () => {
    expect(validarEntrada({ ORGANIZACION_ID: UUID, EJECUCION_ID: UUID })).toEqual({ ok: true, ejecucionId: UUID });
  });
  it('rechaza una entrada inválida con CONFIGURACION_INVALIDA:<conexion> (código 78 en index.ts)', () => {
    expect(validarEntrada({ CONEXION_ID: 'c-1' })).toEqual({ ok: false, stderr: 'CONFIGURACION_INVALIDA:c-1' });
    expect(validarEntrada({ ORGANIZACION_ID: UUID, EJECUCION_ID: 'x; drop table' }).ok).toBe(false);
  });
});
