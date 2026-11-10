import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { celda, celdaTexto, cuerpoCsv, encabezadoCsv } from '../src/csv.js';
import { ejecutarDesdeEntorno, exportarOrganizacion, type Conjunto, type Puertos } from '../src/exportar.js';
import { crearEscritorZip } from '../src/zip.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const EJEC = '22222222-2222-4222-8222-222222222222';
const PROCESO = '33333333-3333-4333-8333-333333333333';
const DESTINO = `${ORG}/${EJEC}.zip`;

const CONJUNTOS: Conjunto[] = [
  { esquema: 'dominio', tabla: 'productos', columnas: ['id', 'nombre', 'precio'] },
  { esquema: 'public', tabla: 'clientes', columnas: ['id', 'nombre'] },
];

let directorio: string;
beforeEach(() => {
  directorio = mkdtempSync(join(tmpdir(), 'exportar-organizacion-test-'));
});
afterEach(() => {
  rmSync(directorio, { recursive: true, force: true });
});

function armar(datosPorTabla: Record<string, Record<string, unknown>[]>, sobre: Partial<Puertos> = {}, conjuntos = CONJUNTOS) {
  const subidas: { destino: string; zip: Uint8Array }[] = [];
  const cierresProceso: unknown[][] = [];
  const cierresEjecucion: unknown[][] = [];
  const progresos: number[][] = [];
  const errores: unknown[][] = [];
  const pedidos: unknown[][] = [];
  const limpiezas: string[][] = [];
  const puertos: Puertos = {
    enCurso: async () => true,
    datos: async () => ({ organizacion_id: ORG, proceso_id: PROCESO, conjuntos: conjuntos.length }),
    conjuntos: async () => conjuntos,
    filas: async (_id, esquema, tabla, desde, limite) => {
      pedidos.push([esquema, tabla, desde, limite]);
      return (datosPorTabla[`${esquema}.${tabla}`] ?? []).slice(desde, desde + limite);
    },
    progreso: async (_p, procesados, total) => { progresos.push([procesados, total]); },
    errorConjunto: async (...args) => { errores.push(args); },
    cancelado: async () => false,
    cerrarProceso: async (...args) => { cierresProceso.push(args); },
    abrirZip: () => crearEscritorZip({ directorio }),
    subir: async (archivo, destino) => { subidas.push({ destino, zip: new Uint8Array(readFileSync(archivo.ruta)) }); },
    limpiarAnteriores: async (carpeta, conservar) => { limpiezas.push([carpeta, conservar]); },
    cerrarEjecucion: async (...args) => { cierresEjecucion.push(args); },
    evento: () => {},
    ...sobre,
  };
  return { puertos, subidas, cierresProceso, cierresEjecucion, progresos, errores, pedidos, limpiezas };
}

// strFromU8 descarta el BOM: se decodifica conservándolo para verificarlo.
const strFromU8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

const productos = Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, nombre: `Producto ${i + 1}`, precio: 10.5 * (i + 1) }));
const clientes = [{ id: 'c1', nombre: 'Ana' }];

describe('ZIP con un CSV por conjunto (FR-033)', () => {
  it('sube un ZIP con un CSV por conjunto, un LEEME y cierra completado', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.subidas).toHaveLength(1);
    expect(t.subidas[0].destino).toBe(DESTINO);
    const archivos = unzipSync(t.subidas[0].zip);
    expect(Object.keys(archivos).sort()).toEqual(['LEEME.txt', 'dominio/productos.csv', 'public/clientes.csv']);
    const csv = strFromU8(archivos['dominio/productos.csv']);
    expect(csv.startsWith('﻿')).toBe(true);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas[0]).toBe('id;nombre;precio');
    expect(lineas[1]).toBe('p1;Producto 1;10.5');
    expect(lineas).toHaveLength(7);
    expect(strFromU8(archivos['LEEME.txt'])).toContain('dominio/productos.csv: 5');
    expect(t.cierresProceso).toEqual([[PROCESO, 'completado', '']]);
    expect(t.cierresEjecucion[0].slice(0, 2)).toEqual([EJEC, 'exitosa']);
  });

  it('informa el avance por conjunto con total = cantidad de conjuntos', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(t.progresos).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('lee por lotes sin cargar el conjunto entero', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    await exportarOrganizacion(EJEC, ORG, t.puertos, { tamanoLote: 2 });
    expect(t.pedidos.filter((p) => p[1] === 'productos').map((p) => [p[2], p[3]])).toEqual([[0, 2], [2, 2], [4, 2]]);
    const csv = strFromU8(unzipSync(t.subidas[0].zip)['dominio/productos.csv']);
    expect(csv.trim().split('\r\n')).toHaveLength(6);
  });

  it('un conjunto vacío igual sale con su encabezado', async () => {
    const t = armar({ 'dominio.productos': [], 'public.clientes': clientes });
    await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(strFromU8(unzipSync(t.subidas[0].zip)['dominio/productos.csv'])).toBe('﻿id;nombre;precio\r\n');
  });

  it('no deja archivos temporales en disco', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(readdirSync(directorio)).toEqual([]);
  });
});

describe('errores por conjunto (FR-034)', () => {
  it('un conjunto que falla se registra, el resto sigue y cierra con_errores', async () => {
    const t = armar({ 'public.clientes': clientes }, {
      filas: async (_id, esquema, tabla) => {
        if (tabla === 'productos') throw new Error('relation "dominio.productos" secreto interno');
        return esquema === 'public' ? clientes : [];
      },
    });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.errores).toEqual([[PROCESO, 0, 'dominio.productos', 'No se pudo leer el conjunto completo']]);
    expect(JSON.stringify(t.errores)).not.toContain('secreto interno');
    expect(t.cierresProceso).toEqual([[PROCESO, 'con_errores', '']]);
    const leeme = strFromU8(unzipSync(t.subidas[0].zip)['LEEME.txt']);
    expect(leeme).toContain('dominio/productos.csv: 0 (INCOMPLETO');
  });

  it('si fallan todos los conjuntos es una falla técnica: no sube nada y deja que el flow reintente', async () => {
    const t = armar({}, { filas: async () => { throw new Error('conexión caída'); } });
    await expect(exportarOrganizacion(EJEC, ORG, t.puertos)).rejects.toThrow('TODOS_LOS_CONJUNTOS_FALLARON');
    expect(t.subidas).toHaveLength(0);
    expect(readdirSync(directorio)).toEqual([]);
  });
});

describe('cancelación (FR-034, SC-005)', () => {
  it('cancelada antes de empezar un conjunto: sin ZIP, sin subida, cierra cancelado', async () => {
    let consultas = 0;
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      cancelado: async () => { consultas += 1; return consultas >= 2; },
    });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.subidas).toHaveLength(0);
    expect(t.limpiezas).toHaveLength(0);
    expect(t.cierresProceso).toEqual([[PROCESO, 'cancelado', 'CANCELADA']]);
    expect(t.cierresEjecucion[0].slice(0, 2)).toEqual([EJEC, 'exitosa']);
    expect(readdirSync(directorio)).toEqual([]);
  });

  it('cancelada entre lotes de un conjunto: corta sin ZIP parcial', async () => {
    let consultas = 0;
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      // 1.ª antes del conjunto, 2.ª entre lotes.
      cancelado: async () => { consultas += 1; return consultas >= 2; },
    });
    await exportarOrganizacion(EJEC, ORG, t.puertos, { tamanoLote: 2 });
    expect(t.pedidos).toHaveLength(1);
    expect(t.subidas).toHaveLength(0);
    expect(t.cierresProceso[0].slice(1, 2)).toEqual(['cancelado']);
    expect(readdirSync(directorio)).toEqual([]);
  });
});

describe('fallas no reintentables (código 78)', () => {
  it('ejecución que ya no está en curso', async () => {
    const t = armar({}, { enCurso: async () => false });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s).toEqual({ codigo: 78, stderr: `EJECUCION_NO_EN_CURSO:${EJEC}` });
    expect(t.subidas).toHaveLength(0);
  });

  it('ejecución de otra organización', async () => {
    const t = armar({}, { datos: async () => ({ organizacion_id: '99999999-9999-4999-8999-999999999999', proceso_id: PROCESO, conjuntos: 2 }) });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s).toEqual({ codigo: 78, stderr: `CONFIGURACION_INVALIDA:${EJEC}` });
    expect(t.subidas).toHaveLength(0);
  });

  it('el ZIP supera el tope: proceso fallido con motivo sanitizado y sin archivo', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      abrirZip: () => crearEscritorZip({ directorio, topeBytes: 10 }),
    });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s).toEqual({ codigo: 78, stderr: `TOPE_EXCEDIDO:${EJEC}` });
    expect(t.subidas).toHaveLength(0);
    expect(t.cierresProceso[0].slice(0, 2)).toEqual([PROCESO, 'fallido']);
    expect(String(t.cierresProceso[0][2])).toMatch(/^TOPE_EXCEDIDO/);
    expect(t.cierresEjecucion[0].slice(0, 2)).toEqual([EJEC, 'fallida']);
    expect(readdirSync(directorio)).toEqual([]);
  });

  it('entrada inválida del entorno', async () => {
    const s = await ejecutarDesdeEntorno({ ORGANIZACION_ID: 'x', EJECUCION_ID: EJEC }, () => { throw new Error('no debe crear puertos'); });
    expect(s.codigo).toBe(78);
    expect(s.stderr).toBe(`CONFIGURACION_INVALIDA:${EJEC}`);
  });

  it('con el entorno completo delega y cierra los puertos', async () => {
    let cerrado = false;
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    const s = await ejecutarDesdeEntorno(
      { ORGANIZACION_ID: ORG, EJECUCION_ID: EJEC, SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      () => ({ puertos: t.puertos, cerrar: async () => { cerrado = true; } }),
    );
    expect(s.codigo).toBe(0);
    expect(cerrado).toBe(true);
  });
});

describe('falla técnica en la subida', () => {
  it('propaga el error para que el flow reintente, sin cerrar el proceso y sin dejar el temporal', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      subir: async () => { throw new Error('SUBIDA_FALLIDA:500'); },
    });
    await expect(exportarOrganizacion(EJEC, ORG, t.puertos)).rejects.toThrow('SUBIDA_FALLIDA:500');
    expect(t.cierresProceso).toHaveLength(0);
    expect(readdirSync(directorio)).toEqual([]);
  });
});

describe('retención del archivo anterior (FR-037)', () => {
  it('borra los ZIP anteriores de la organización conservando el nuevo', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes });
    await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(t.limpiezas).toEqual([[`${ORG}/`, DESTINO]]);
  });

  it('si la limpieza falla, la exportación igual termina bien', async () => {
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      limpiarAnteriores: async () => { throw new Error('BORRADO_FALLIDO:500'); },
    });
    const s = await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(s.codigo).toBe(0);
    expect(t.cierresProceso[0].slice(0, 2)).toEqual([PROCESO, 'completado']);
  });

  it('la limpieza corre después de la subida y antes del cierre', async () => {
    const orden: string[] = [];
    const t = armar({ 'dominio.productos': productos, 'public.clientes': clientes }, {
      subir: async () => { orden.push('subir'); },
      limpiarAnteriores: async () => { orden.push('limpiar'); },
      cerrarProceso: async () => { orden.push('cerrar'); },
    });
    await exportarOrganizacion(EJEC, ORG, t.puertos);
    expect(orden).toEqual(['subir', 'limpiar', 'cerrar']);
  });
});

describe('CSV', () => {
  it('cita comillas, separador y saltos de línea', () => {
    expect(celdaTexto('a;b')).toBe('"a;b"');
    expect(celdaTexto('di "hola"')).toBe('"di ""hola"""');
    expect(celdaTexto('l1\nl2')).toBe('"l1\nl2"');
  });

  it('neutraliza fórmulas en texto pero no en números', () => {
    expect(celdaTexto('=1+1')).toBe("'=1+1");
    expect(celdaTexto('+54911')).toBe("'+54911");
    expect(celdaTexto('-cmd')).toBe("'-cmd");
    expect(celdaTexto('@SUMA(A1)')).toBe("'@SUMA(A1)");
    expect(celda(-5.25)).toBe('-5.25');
  });

  it('serializa null, booleanos y JSON', () => {
    expect(celda(null)).toBe('');
    expect(celda(true)).toBe('true');
    expect(celda({ a: 1 })).toBe('"{""a"":1}"');
    expect(celda(['x', 'y'])).toBe('"[""x"",""y""]"');
  });

  it('respeta el orden de columnas del conjunto', () => {
    expect(encabezadoCsv(['b', 'a'])).toBe('﻿b;a\r\n');
    expect(cuerpoCsv(['b', 'a'], [{ a: 1, b: 2 }])).toBe('2;1\r\n');
  });
});

describe('crearEscritorZip', () => {
  it('descartar borra el archivo temporal', () => {
    const zip = crearEscritorZip({ directorio });
    const e = zip.abrirEntrada('a.csv');
    e.escribir('x');
    e.terminar();
    zip.descartar();
    expect(existsSync(directorio) && readdirSync(directorio)).toEqual([]);
  });
});
