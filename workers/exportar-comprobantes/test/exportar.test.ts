import { describe, expect, it, vi } from 'vitest';
import { celdaTexto, formatearFecha, formatearTotal } from '../src/csv.js';
import { ejecutarDesdeEntorno, exportarComprobantes, type FilaPagina, type Puertos } from '../src/exportar.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const EJEC = '22222222-2222-4222-8222-222222222222';
const ARCHIVO = `${ORG}/33333333-3333-4333-8333-333333333333/${EJEC}.csv`;

function fila(i: number, extra: Partial<FilaPagina> = {}, filas = 1): FilaPagina {
  return {
    numero: `0001-${String(i).padStart(8, '0')}`, tipo: 'factura', empresa: 'Tienda A', fecha: '2026-10-24',
    cliente: `Cliente ${i}`, operador: 'Ana', estado_etiqueta: 'Emitido', forma_pago: 'Efectivo', envio: 'Retiro',
    total: '1234.5', filas, ...extra,
  };
}

function armar(todas: FilaPagina[], sobre: Partial<Puertos> = {}) {
  const subidas: { ruta: string; texto: string }[] = [];
  const cierres: unknown[][] = [];
  const pedidos: number[][] = [];
  const limpiezas: string[][] = [];
  const puertos: Puertos = {
    enCurso: async () => true,
    datos: async () => ({ organizacion_id: ORG, tipo: 'comprobantes', filtros: { estado: 'emitido' }, empresas: [], actor: 'x', archivo: ARCHIVO }),
    pagina: async (_id, desde, limite) => { pedidos.push([desde, limite]); return todas.slice(desde, desde + limite).map((f) => ({ ...f, filas: todas.length })); },
    subir: async (ruta, contenido) => { subidas.push({ ruta, texto: contenido.toString('utf8') }); },
    limpiarAnteriores: async (carpeta, conservar) => { limpiezas.push([carpeta, conservar]); },
    cerrar: async (...args) => { cierres.push(args); },
    evento: () => {},
    ...sobre,
  };
  return { puertos, subidas, cierres, pedidos, limpiezas };
}

describe('retención del CSV', () => {
  it('borra los CSV anteriores del usuario conservando el nuevo', async () => {
    const t = armar([fila(1)]);
    await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(t.limpiezas).toEqual([[ARCHIVO.slice(0, ARCHIVO.lastIndexOf('/') + 1), ARCHIVO]]);
  });

  it('si la limpieza falla, la exportación igual termina bien', async () => {
    const t = armar([fila(1)], { limpiarAnteriores: async () => { throw new Error('BORRADO_FALLIDO:500'); } });
    const s = await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.cierres[0][1]).toBe('exitosa');
  });
});

describe('CSV', () => {
  it('usa BOM, separador ;, CRLF y encabezados en castellano', async () => {
    const t = armar([fila(1), fila(2)]);
    const s = await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    const texto = t.subidas[0].texto;
    expect(texto.startsWith('﻿')).toBe(true);
    const lineas = texto.slice(1).split('\r\n');
    expect(lineas[0]).toBe('Comprobante;Tipo;Tienda;Fecha;Cliente;Operador;Estado;Pago;Envío;Total');
    expect(lineas[1]).toBe('0001-00000001;Factura;Tienda A;24/10/2026;Cliente 1;Ana;Emitido;Efectivo;Retiro;1234,50');
    expect(lineas[3]).toBe('');
    expect(Buffer.from(texto, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('cita según RFC 4180', () => {
    expect(celdaTexto('Pérez; "Hnos"')).toBe('"Pérez; ""Hnos"""');
    expect(celdaTexto('a\nb')).toBe('"a\nb"');
    expect(celdaTexto(null)).toBe('');
  });

  it('neutraliza fórmulas en texto pero no el total negativo', async () => {
    for (const peligroso of ['=SUMA(A1)', '+54 11', '-1', '@x', '\tx', '\rx']) {
      expect(celdaTexto(peligroso).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
    const t = armar([fila(1, { cliente: '=HYPERLINK("http://x")', total: '-500' })]);
    await exportarComprobantes(EJEC, ORG, t.puertos);
    const linea = t.subidas[0].texto.split('\r\n')[1];
    expect(linea).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(linea.endsWith(';-500,00')).toBe(true);
  });

  it('formatea fecha y total', () => {
    expect(formatearFecha('2026-01-05')).toBe('05/01/2026');
    expect(formatearFecha(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(formatearTotal('0')).toBe('0,00');
    expect(formatearTotal(null)).toBe('');
  });
});

describe('paginación, tope y filtros', () => {
  it('pagina en lotes hasta agotar las filas', async () => {
    const t = armar(Array.from({ length: 12 }, (_, i) => fila(i + 1)));
    const s = await exportarComprobantes(EJEC, ORG, t.puertos, { tamanoLote: 5 });
    expect(s.codigo).toBe(0);
    expect(t.pedidos).toEqual([[0, 5], [5, 5], [10, 5]]);
    expect(t.subidas[0].texto.split('\r\n')).toHaveLength(12 + 2);
    expect(t.cierres[0]).toEqual([EJEC, 'exitosa', 'EXPORTADAS:12', { filas: 12, archivo: ARCHIVO }]);
  });

  it('con cero filas sube solo el encabezado y cierra exitosa', async () => {
    const t = armar([]);
    const s = await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.subidas[0].texto.split('\r\n')).toEqual([expect.stringContaining('Comprobante'), '']);
  });

  it('los filtros guardados los aplica la base: el worker pide por ejecución', async () => {
    const pagina = vi.fn(async () => [] as FilaPagina[]);
    const t = armar([], { pagina });
    await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(pagina).toHaveBeenCalledWith(EJEC, 0, 5000);
  });

  it('supera el tope: 78 TOPE_EXCEDIDO, cierra fallida y no sube', async () => {
    const t = armar(Array.from({ length: 6 }, (_, i) => fila(i + 1)));
    const s = await exportarComprobantes(EJEC, ORG, t.puertos, { tamanoLote: 2, topeFilas: 5 });
    expect(s).toEqual({ codigo: 78, stderr: `TOPE_EXCEDIDO:${EJEC}` });
    expect(t.subidas).toHaveLength(0);
    expect(t.cierres[0]?.[1]).toBe('fallida');
  });
});

describe('idempotencia y contrato', () => {
  it('reintentar sube a la misma ruta (upsert) sin duplicar', async () => {
    const t = armar([fila(1)]);
    await exportarComprobantes(EJEC, ORG, t.puertos);
    await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(t.subidas.map((s) => s.ruta)).toEqual([ARCHIVO, ARCHIVO]);
    expect(t.subidas[0].texto).toBe(t.subidas[1].texto);
  });

  it('ejecución no en curso: 78 y no toca nada', async () => {
    const datos = vi.fn();
    const t = armar([], { enCurso: async () => false, datos });
    const s = await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(s).toEqual({ codigo: 78, stderr: `EJECUCION_NO_EN_CURSO:${EJEC}` });
    expect(datos).not.toHaveBeenCalled();
    expect(t.subidas).toHaveLength(0);
  });

  it('organización distinta: 78 CONFIGURACION_INVALIDA', async () => {
    const t = armar([], { datos: async () => ({ organizacion_id: '99999999-9999-4999-8999-999999999999', tipo: 'comprobantes', filtros: {}, empresas: [], actor: 'x', archivo: ARCHIVO }) });
    const s = await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(s).toEqual({ codigo: 78, stderr: `CONFIGURACION_INVALIDA:${EJEC}` });
  });

  it('falla técnica de subida se propaga (exit 1 en el entrypoint) y no cierra la ejecución', async () => {
    const t = armar([fila(1)], { subir: async () => { throw new Error('SUBIDA_FALLIDA:503'); } });
    await expect(exportarComprobantes(EJEC, ORG, t.puertos)).rejects.toThrow('SUBIDA_FALLIDA:503');
    expect(t.cierres).toHaveLength(0);
  });

  it('el entorno incompleto es 78 CONFIGURACION_INVALIDA y no abre puertos', async () => {
    const crear = vi.fn();
    const s = await ejecutarDesdeEntorno({ ORGANIZACION_ID: ORG }, crear);
    expect(s.codigo).toBe(78);
    expect(s.stderr).toMatch(/^CONFIGURACION_INVALIDA:/);
    expect(crear).not.toHaveBeenCalled();
  });

  it('con entorno válido delega y cierra los puertos', async () => {
    const t = armar([fila(1)]);
    const cerrar = vi.fn(async () => {});
    const s = await ejecutarDesdeEntorno(
      { ORGANIZACION_ID: ORG, EJECUCION_ID: EJEC, SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      () => ({ puertos: t.puertos, cerrar }),
    );
    expect(s.codigo).toBe(0);
    expect(cerrar).toHaveBeenCalled();
  });

  it('el motivo de cierre no contiene datos de clientes', async () => {
    const t = armar([fila(1, { cliente: 'Secreto SA' })]);
    await exportarComprobantes(EJEC, ORG, t.puertos);
    expect(JSON.stringify(t.cierres)).not.toContain('Secreto');
  });
});
