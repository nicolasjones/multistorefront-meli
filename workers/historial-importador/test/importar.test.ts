import { describe, expect, it } from 'vitest';
import type { Tipo } from '../src/campos.js';
import {
  ejecutarDesdeEntorno,
  importarHistorial,
  MAX_RECHAZOS_EN_DETALLE,
  SALIDA_NO_REINTENTABLE,
  SALIDA_OK,
  type Puertos,
} from '../src/importar.js';
import type { FilaValida } from '../src/validar.js';
import { crearXlsx } from './xlsx.js';

const EJECUCION = '11111111-1111-1111-1111-111111111111';

interface Cierre {
  estado: string;
  motivo: string;
  detalle: Record<string, unknown>;
}

/** Puertos en memoria: la «base» aplica la misma idempotencia por clave natural que `on conflict do nothing`. */
function crearPuertos(opciones: { tipo?: string; archivo?: Buffer | Error; nombreArchivo?: string; enCurso?: boolean }) {
  const claves = new Set<string>();
  const lotes: FilaValida[][] = [];
  const cierres: Cierre[] = [];
  const eventos: string[] = [];
  const clavePorTipo: Record<string, (f: FilaValida) => string> = {
    comprobantes: (f) => `${f.tienda}|${f.tipo}|${f.numero}`,
    cobros: (f) => `${f.tienda}|${f.comprobante_numero}|${f.fecha}|${f.importe}`,
    cotizaciones: (f) => `${f.fecha}`,
  };
  const puertos: Puertos = {
    enCurso: async () => opciones.enCurso ?? true,
    datos: async () => ({ tipo: opciones.tipo ?? 'comprobantes', archivo: `${EJECUCION}/${opciones.nombreArchivo ?? 'planilla.csv'}` }),
    tiendas: async () => ['San Javucho', 'Mundo JC'],
    descargar: async () => {
      if (opciones.archivo instanceof Error) throw opciones.archivo;
      return opciones.archivo ?? Buffer.alloc(0);
    },
    insertarLote: async (_id, tipo: Tipo, filas) => {
      lotes.push(filas);
      let nuevas = 0;
      for (const fila of filas) {
        const clave = `${tipo}|${clavePorTipo[tipo](fila)}`;
        if (!claves.has(clave)) {
          claves.add(clave);
          nuevas += 1;
        }
      }
      return { nuevas, existentes: filas.length - nuevas };
    },
    cerrar: async (_id, estado, motivo, detalle) => {
      cierres.push({ estado, motivo, detalle });
    },
    evento: (etapa, estado) => {
      eventos.push(`${etapa}:${estado}`);
    },
  };
  return { puertos, lotes, cierres, eventos };
}

const CSV_COMPROBANTES =
  'Tienda;Tipo;Comprobante;Fecha;Cliente;Número de cliente;Operador;Estado final;Total\n' +
  'San Javucho;Factura;0001-00000009;10/01/2020;Pérez Juan;C-15;Ana;Entregado;"1.234,56"\n' +
  'mundo jc;Factura;0001-00000010;11/01/2020;Gómez Lucía;;Beto;Pagado;200\n';

describe('importación exitosa', () => {
  it('importa un CSV de comprobantes con todas las columnas y cierra exitosa con el conteo', async () => {
    const { puertos, lotes, cierres } = crearPuertos({ archivo: Buffer.from(CSV_COMPROBANTES, 'utf8') });
    const salida = await importarHistorial(EJECUCION, puertos);
    expect(salida).toEqual({ codigo: SALIDA_OK });
    expect(lotes.flat()).toEqual([
      {
        tienda: 'San Javucho',
        tipo: 'Factura',
        numero: '0001-00000009',
        fecha: '2020-01-10',
        cliente_nombre: 'Pérez Juan',
        cliente_numero: 'C-15',
        operador: 'Ana',
        estado_final: 'Entregado',
        total: 1234.56,
      },
      {
        tienda: 'Mundo JC',
        tipo: 'Factura',
        numero: '0001-00000010',
        fecha: '2020-01-11',
        cliente_nombre: 'Gómez Lucía',
        cliente_numero: null,
        operador: 'Beto',
        estado_final: 'Pagado',
        total: 200,
      },
    ]);
    expect(cierres).toEqual([
      { estado: 'exitosa', motivo: 'IMPORTADAS:2', detalle: { tipo: 'comprobantes', total_filas: 2, nuevas: 2, existentes: 0 } },
    ]);
  });

  it('importa cobros desde Excel (celda de fecha incluida)', async () => {
    const xlsx = crearXlsx([
      ['Tienda', 'Fecha', 'Comprobante', 'Cliente', 'Cuenta de cobro', 'Aprobado por', 'Importe'],
      ['San Javucho', { fecha: 43840 }, '0001-00000009', 'Pérez Juan', 'Caja', 'Ana', 1500.5],
    ]);
    const { puertos, lotes, cierres } = crearPuertos({ tipo: 'cobros', archivo: xlsx, nombreArchivo: 'cobros.xlsx' });
    expect((await importarHistorial(EJECUCION, puertos)).codigo).toBe(SALIDA_OK);
    expect(lotes[0][0]).toMatchObject({
      fecha: '2020-01-10',
      comprobante_numero: '0001-00000009',
      cuenta_cobro: 'Caja',
      aprobado_por: 'Ana',
      importe: 1500.5,
    });
    expect(cierres[0].estado).toBe('exitosa');
  });

  it('importa cotizaciones desde Excel', async () => {
    const xlsx = crearXlsx([
      ['Fecha', 'Dólar comprador', 'Dólar vendedor', 'Cargó'],
      [{ fecha: 43840 }, 59.5, 63.5, 'Ana'],
      ['11/01/2020', '60,25', '64', ''],
    ]);
    const { puertos, lotes } = crearPuertos({ tipo: 'cotizaciones', archivo: xlsx, nombreArchivo: 'cotizaciones.xlsx' });
    expect((await importarHistorial(EJECUCION, puertos)).codigo).toBe(SALIDA_OK);
    expect(lotes[0]).toEqual([
      { fecha: '2020-01-10', dolar_comprador: 59.5, dolar_vendedor: 63.5, cargado_por: 'Ana' },
      { fecha: '2020-01-11', dolar_comprador: 60.25, dolar_vendedor: 64, cargado_por: null },
    ]);
  });

  it('reimportar el mismo archivo no duplica y cuenta las existentes', async () => {
    const { puertos, cierres } = crearPuertos({ archivo: Buffer.from(CSV_COMPROBANTES, 'utf8') });
    await importarHistorial(EJECUCION, puertos);
    const segunda = await importarHistorial(EJECUCION, puertos);
    expect(segunda.codigo).toBe(SALIDA_OK);
    expect(cierres[1].detalle).toMatchObject({ nuevas: 0, existentes: 2 });
  });

  it('inserta por lotes del tamaño pedido', async () => {
    const filas = Array.from({ length: 5 }, (_, i) => `San Javucho;Factura;${i + 1};10/01/2020;Cliente ${i};10`).join('\n');
    const csv = `Tienda;Tipo;Comprobante;Fecha;Cliente;Total\n${filas}\n`;
    const { puertos, lotes, cierres } = crearPuertos({ archivo: Buffer.from(csv, 'utf8') });
    await importarHistorial(EJECUCION, puertos, { tamanoLote: 2 });
    expect(lotes.map((l) => l.length)).toEqual([2, 2, 1]);
    expect(cierres[0].detalle).toMatchObject({ nuevas: 5 });
  });
});

describe('rechazo todo o nada', () => {
  it('con una fila inválida no inserta nada y cierra fallida con fila, columna y motivo (sin valores)', async () => {
    const csv =
      'Tienda;Tipo;Comprobante;Fecha;Cliente;Total\n' +
      'San Javucho;Factura;1;10/01/2020;Pérez Juan;100\n' +
      'San Javucho;Factura;2;31/02/2020;Gómez Lucía;abc\n' +
      'Tienda Fantasma;Factura;3;10/01/2020;Otro Cliente;50\n';
    const { puertos, lotes, cierres } = crearPuertos({ archivo: Buffer.from(csv, 'utf8') });
    const salida = await importarHistorial(EJECUCION, puertos);
    expect(salida).toEqual({ codigo: SALIDA_NO_REINTENTABLE, stderr: `VALIDACION_FALLIDA:${EJECUCION}` });
    expect(lotes).toHaveLength(0);
    expect(cierres).toHaveLength(1);
    expect(cierres[0].estado).toBe('fallida');
    expect(cierres[0].detalle.rechazos).toEqual([
      { fila: 3, columna: 'Fecha', motivo: 'Fecha ilegible (se espera dd/mm/aaaa o aaaa-mm-dd)' },
      { fila: 3, columna: 'Total', motivo: 'Importe no numérico' },
      { fila: 4, columna: 'Tienda', motivo: 'La tienda no existe en la organización' },
    ]);
    const serializado = JSON.stringify(cierres[0]);
    for (const dato of ['Pérez', 'Gómez', 'Fantasma', 'abc']) expect(serializado).not.toContain(dato);
  });

  it('informa cada columna obligatoria ausente', async () => {
    const { puertos, lotes, cierres } = crearPuertos({ archivo: Buffer.from('Tienda;Cliente\nSan Javucho;Pérez\n', 'utf8') });
    const salida = await importarHistorial(EJECUCION, puertos);
    expect(salida.codigo).toBe(SALIDA_NO_REINTENTABLE);
    expect(lotes).toHaveLength(0);
    expect(cierres[0].detalle.rechazos).toEqual([
      { fila: 1, columna: 'Comprobante', motivo: 'Falta la columna obligatoria' },
      { fila: 1, columna: 'Fecha', motivo: 'Falta la columna obligatoria' },
      { fila: 1, columna: 'Total', motivo: 'Falta la columna obligatoria' },
    ]);
  });

  it.each([
    ['vacío', ''],
    ['solo encabezados', 'Tienda;Comprobante;Fecha;Cliente;Total\n'],
  ])('rechaza un archivo %s', async (_nombre, csv) => {
    const { puertos, lotes, cierres } = crearPuertos({ archivo: Buffer.from(csv, 'utf8') });
    expect((await importarHistorial(EJECUCION, puertos)).codigo).toBe(SALIDA_NO_REINTENTABLE);
    expect(lotes).toHaveLength(0);
    expect(cierres[0].estado).toBe('fallida');
  });

  it('rechaza una cotización negativa y un archivo que supera el máximo de filas', async () => {
    const negativa = crearPuertos({
      tipo: 'cotizaciones',
      archivo: Buffer.from('Fecha;Dólar comprador;Dólar vendedor\n10/01/2020;-1;2\n', 'utf8'),
    });
    await importarHistorial(EJECUCION, negativa.puertos);
    expect(negativa.cierres[0].detalle.rechazos).toEqual([
      { fila: 2, columna: 'Dólar comprador', motivo: 'La cotización no puede ser negativa' },
    ]);

    const grande = crearPuertos({
      tipo: 'cotizaciones',
      archivo: Buffer.from('Fecha;Dólar comprador;Dólar vendedor\n10/01/2020;1;2\n11/01/2020;1;2\n', 'utf8'),
    });
    await importarHistorial(EJECUCION, grande.puertos, { maxFilas: 1 });
    expect(grande.cierres[0].detalle.rechazos).toEqual([
      { fila: 1, columna: '(archivo)', motivo: 'El archivo supera el máximo de 1 filas' },
    ]);
  });

  it(`guarda como mucho ${MAX_RECHAZOS_EN_DETALLE} rechazos en el detalle y el total real`, async () => {
    const filas = Array.from({ length: 150 }, () => 'San Javucho;Factura;1;fecha mala;Cliente;10').join('\n');
    const csv = `Tienda;Tipo;Comprobante;Fecha;Cliente;Total\n${filas}\n`;
    const { puertos, cierres } = crearPuertos({ archivo: Buffer.from(csv, 'utf8') });
    await importarHistorial(EJECUCION, puertos);
    expect((cierres[0].detalle.rechazos as unknown[]).length).toBe(MAX_RECHAZOS_EN_DETALLE);
    expect(cierres[0].detalle.total_rechazos).toBe(150);
    expect(cierres[0].detalle.rechazos_truncados).toBe(true);

    const muchas = Array.from({ length: 1001 }, () => 'San Javucho;Factura;1;fecha mala;Cliente;10').join('\n');
    const enorme = crearPuertos({ archivo: Buffer.from(`Tienda;Tipo;Comprobante;Fecha;Cliente;Total\n${muchas}\n`, 'utf8') });
    await importarHistorial(EJECUCION, enorme.puertos);
    expect((enorme.cierres[0].detalle.rechazos as unknown[]).length).toBe(MAX_RECHAZOS_EN_DETALLE);
    expect(enorme.cierres[0].detalle.total_rechazos).toBe(1001);
    expect(enorme.cierres[0].detalle.rechazos_truncados).toBe(true);
  });

  it('un .xlsx dañado cierra fallida (no reintentable)', async () => {
    const { puertos, cierres } = crearPuertos({ archivo: Buffer.from('no es un zip'), nombreArchivo: 'roto.xlsx' });
    const salida = await importarHistorial(EJECUCION, puertos);
    expect(salida.codigo).toBe(SALIDA_NO_REINTENTABLE);
    expect(cierres[0].estado).toBe('fallida');
    expect(cierres[0].detalle.rechazos).toEqual([
      { fila: 1, columna: '(archivo)', motivo: 'No se pudo leer la planilla Excel (.xlsx)' },
    ]);
  });
});

describe('códigos de salida del contrato', () => {
  it('con la ejecución ya cerrada sale con 78 y EJECUCION_NO_EN_CURSO sin leer ni escribir nada', async () => {
    const { puertos, lotes, cierres } = crearPuertos({ enCurso: false, archivo: Buffer.from(CSV_COMPROBANTES, 'utf8') });
    const salida = await importarHistorial(EJECUCION, puertos);
    expect(salida).toEqual({ codigo: 78, stderr: `EJECUCION_NO_EN_CURSO:${EJECUCION}` });
    expect(lotes).toHaveLength(0);
    expect(cierres).toHaveLength(0);
  });

  it('un tipo desconocido es CONFIGURACION_INVALIDA (78)', async () => {
    const { puertos } = crearPuertos({ tipo: 'facturas', archivo: Buffer.alloc(0) });
    expect(await importarHistorial(EJECUCION, puertos)).toEqual({ codigo: 78, stderr: `CONFIGURACION_INVALIDA:${EJECUCION}` });
  });

  it('una falla técnica (descarga, base) se propaga sin cerrar la ejecución: el flow reintenta', async () => {
    const { puertos, cierres } = crearPuertos({ archivo: new Error('DESCARGA_FALLIDA:503') });
    await expect(importarHistorial(EJECUCION, puertos)).rejects.toThrow('DESCARGA_FALLIDA:503');
    expect(cierres).toHaveLength(0);
  });

  it('emite eventos por etapa del contrato', async () => {
    const { puertos, eventos } = crearPuertos({ archivo: Buffer.from(CSV_COMPROBANTES, 'utf8') });
    await importarHistorial(EJECUCION, puertos);
    expect(eventos).toEqual([
      'inicio:completada',
      'validacion:iniciada',
      'validacion:completada',
      'insercion:iniciada',
      'insercion:completada',
    ]);
  });
});

describe('entrada por entorno', () => {
  const entornoValido = {
    ORGANIZACION_ID: '22222222-2222-2222-2222-222222222222',
    EJECUCION_ID: EJECUCION,
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'clave-de-prueba',
  };

  it.each(['ORGANIZACION_ID', 'EJECUCION_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])(
    'sin %s sale con 78 y CONFIGURACION_INVALIDA, sin crear conexiones',
    async (faltante) => {
      let creados = 0;
      const env = { ...entornoValido, CONEXION_ID: 'c0nex10n', [faltante]: undefined };
      const salida = await ejecutarDesdeEntorno(env, () => {
        creados += 1;
        throw new Error('no debe crearse');
      });
      expect(salida).toEqual({ codigo: 78, stderr: 'CONFIGURACION_INVALIDA:c0nex10n' });
      expect(creados).toBe(0);
    },
  );

  it('rechaza una EJECUCION_ID que no es un uuid', async () => {
    const salida = await ejecutarDesdeEntorno({ ...entornoValido, EJECUCION_ID: 'abc' }, () => {
      throw new Error('no debe crearse');
    });
    expect(salida.codigo).toBe(78);
  });

  it('cierra siempre los recursos, también cuando el importador falla', async () => {
    let cerrado = false;
    const { puertos } = crearPuertos({ archivo: new Error('DESCARGA_FALLIDA:500') });
    await expect(
      ejecutarDesdeEntorno(entornoValido, () => ({
        puertos,
        cerrar: async () => {
          cerrado = true;
        },
      })),
    ).rejects.toThrow();
    expect(cerrado).toBe(true);
  });
});
