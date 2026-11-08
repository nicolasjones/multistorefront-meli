import { describe, expect, it } from 'vitest';
import {
  SALIDA_NO_REINTENTABLE,
  SALIDA_OK,
  ejecutarDesdeEntorno,
  importarProductos,
  type EstadoRegistro,
  type FilaPendiente,
  type Puertos,
  type ResultadoFila,
} from '../src/importar.js';

const EJECUCION = '11111111-1111-1111-1111-111111111111';
const ORGANIZACION = '22222222-2222-2222-2222-222222222222';
const CLAVE = '33333333-3333-3333-3333-333333333333';

// JPEG mínimo válido por sus primeros bytes y PNG con la firma completa.
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

interface FilaSimulada {
  id: string;
  sku: string;
  nuevo: boolean;
  omitir?: string;
  imagenes?: string[];
}

/** «Base» en memoria: cada fila pasa de pendiente a aplicada/omitida una sola vez, como en SQL. */
function crearPuertos(
  filas: FilaSimulada[],
  opciones: {
    enCurso?: boolean;
    temporales?: Record<string, Uint8Array>;
    /** Cuántas subidas a Storage fallan antes de funcionar (simula una caída del servicio). */
    fallasDeSubida?: number;
    rutasABorrar?: string[];
    /** Huérfanos viejos que ofrece la base al empezar la corrida. */
    rutasHuerfanas?: string[];
    /** Filas que SIEMPRE fallan con un error transitorio. */
    siempreFallan?: string[];
    falloLimpieza?: boolean;
  } = {},
) {
  const estado = new Map<string, ResultadoFila>();
  // Filas aplicadas con imágenes sin confirmar: la base las sigue ofreciendo (imagenes_pendientes).
  const imagenesPendientes = new Set<string>();
  const borradas: string[][] = [];
  let fallasRestantes = opciones.fallasDeSubida ?? 0;
  const intentos = new Map<string, number>();
  const colaFinal = [...(opciones.rutasABorrar ?? [])];
  const colaHuerfanos = [...(opciones.rutasHuerfanas ?? [])];
  const ordenBorrado: string[] = [];
  const productos = new Map<string, string>();
  const imagenes = new Set<string>();
  const subidas: string[] = [];
  const eventos: string[] = [];
  const cierres: { importacion?: string; ejecucion?: string }[] = [];
  let despachos = 0;

  const puertos: Puertos = {
    enCurso: async () => opciones.enCurso ?? true,
    iniciar: async () => ({
      importacion_id: 'imp-1',
      organizacion_id: ORGANIZACION,
      clave: CLAVE,
      pendientes: filas.filter((fila) => !estado.has(fila.id) || imagenesPendientes.has(fila.id)).length,
    }),
    pendientes: async (_id, limite): Promise<FilaPendiente[]> =>
      filas
        .filter((fila) => !estado.has(fila.id) || imagenesPendientes.has(fila.id))
        .slice(0, limite)
        .map((fila, indice) => ({ fila_id: fila.id, fila: indice + 2, sku: fila.sku })),
    aplicar: async (_id, filaId) => {
      if (opciones.siempreFallan?.includes(filaId) && !estado.has(filaId)) throw new Error('canceling statement due to lock timeout');
      const guardado = estado.get(filaId);
      if (guardado) return guardado;
      const fila = filas.find((f) => f.id === filaId)!;
      let resultado: ResultadoFila;
      if (fila.omitir) {
        resultado = { resultado: 'omitida', producto_id: null, mensaje: fila.omitir, imagenes: [] };
      } else {
        if (!productos.has(fila.sku)) productos.set(fila.sku, `prod-${fila.sku}`);
        resultado = {
          resultado: 'aplicada',
          producto_id: productos.get(fila.sku)!,
          mensaje: fila.nuevo ? 'Producto creado' : 'Producto actualizado',
          imagenes: fila.imagenes ?? [],
        };
      }
      estado.set(filaId, resultado);
      if (resultado.resultado === 'aplicada' && resultado.imagenes.length > 0) imagenesPendientes.add(filaId);
      return resultado;
    },
    descargarTemporal: async (ruta) => opciones.temporales?.[ruta] ?? null,
    subirImagen: async (ruta) => {
      if (fallasRestantes > 0) {
        fallasRestantes -= 1;
        throw new Error('SUBIDA_FALLIDA:503');
      }
      subidas.push(ruta);
    },
    registrarImagen: async (_id, _fila, _nombre, ruta): Promise<EstadoRegistro> => {
      if (imagenes.has(ruta)) return 'existente';
      imagenes.add(ruta);
      return 'registrada';
    },
    confirmarImagenes: async (_id, filaId) => {
      imagenesPendientes.delete(filaId);
    },
    temporalesABorrar: async (_id, _dias, incluirImportacion) => {
      if (opciones.falloLimpieza) throw new Error('conexión caída');
      ordenBorrado.push(incluirImportacion ? 'cierre' : 'inicio');
      return (incluirImportacion ? colaFinal : colaHuerfanos).splice(0, 1000);
    },
    borrarTemporales: async (rutas) => {
      borradas.push(rutas);
    },
    registrarFallo: async (_id, filaId) => {
      const n = (intentos.get(filaId) ?? 0) + 1;
      intentos.set(filaId, n);
      if (n >= 3) estado.set(filaId, { resultado: 'omitida', producto_id: null, mensaje: 'No se pudo aplicar tras varios intentos', imagenes: [] });
      return n;
    },
    cerrarImportacion: async () => {
      cierres.push({ importacion: 'terminada' });
      return {
        procesadas: [...estado.values()].filter((r) => r.resultado === 'aplicada').length,
        omitidas: [...estado.values()].filter((r) => r.resultado === 'omitida').length,
      };
    },
    cerrarEjecucion: async (_id, est) => {
      cierres.push({ ejecucion: est });
    },
    despacharSiguiente: async () => {
      despachos += 1;
    },
    evento: (etapa, est, mensaje) => {
      eventos.push(`${etapa}:${est}${mensaje ? `:${mensaje}` : ''}`);
    },
  };
  return { puertos, productos, imagenes, subidas, eventos, cierres, estado, borradas, imagenesPendientes, intentos, ordenBorrado, despachos: () => despachos };
}

describe('importarProductos (FR-108)', () => {
  it('da de alta y actualiza, cierra la importación y la ejecución y despacha la siguiente', async () => {
    const mundo = crearPuertos([
      { id: 'f1', sku: 'NEW-1', nuevo: true },
      { id: 'f2', sku: 'EXI-1', nuevo: false },
    ]);
    const salida = await importarProductos(EJECUCION, mundo.puertos);

    expect(salida).toEqual({ codigo: SALIDA_OK });
    expect([...mundo.estado.values()].map((r) => r.mensaje)).toEqual(['Producto creado', 'Producto actualizado']);
    expect(mundo.cierres).toEqual([{ importacion: 'terminada' }, { ejecucion: 'exitosa' }]);
    expect(mundo.despachos()).toBe(1);
  });

  it('una fila omitida no adjunta imágenes ni frena a las demás', async () => {
    const mundo = crearPuertos(
      [
        { id: 'f1', sku: 'MAL', nuevo: true, omitir: 'La categoría «X» ya no existe', imagenes: ['a.jpg'] },
        { id: 'f2', sku: 'BIEN', nuevo: true, imagenes: ['b.jpg'] },
      ],
      { temporales: { [`${ORGANIZACION}/${CLAVE}/b.jpg`]: JPG, [`${ORGANIZACION}/${CLAVE}/a.jpg`]: JPG } },
    );
    await importarProductos(EJECUCION, mundo.puertos);

    expect(mundo.estado.get('f1')?.resultado).toBe('omitida');
    expect(mundo.imagenes.size).toBe(1);
    expect(mundo.subidas[0]).toMatch(new RegExp(`^${ORGANIZACION}/prod-BIEN/imp-[0-9a-f]{12}\\.jpg$`));
  });

  it('adjunta las imágenes citadas desde el bucket temporal a la ruta del producto', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'IMG-1', nuevo: true, imagenes: ['uno.jpg', 'dos.png'] }], {
      temporales: { [`${ORGANIZACION}/${CLAVE}/uno.jpg`]: JPG, [`${ORGANIZACION}/${CLAVE}/dos.png`]: PNG },
    });
    await importarProductos(EJECUCION, mundo.puertos);

    expect(mundo.subidas).toHaveLength(2);
    expect(mundo.subidas[0].endsWith('.jpg')).toBe(true);
    expect(mundo.subidas[1].endsWith('.png')).toBe(true);
    expect(mundo.imagenes.size).toBe(2);
  });

  it('omite la imagen que no se subió, la que no es imagen y la que miente su extensión', async () => {
    const mundo = crearPuertos(
      [{ id: 'f1', sku: 'IMG-2', nuevo: true, imagenes: ['falta.jpg', 'texto.jpg', 'mentira.png'] }],
      {
        temporales: {
          [`${ORGANIZACION}/${CLAVE}/texto.jpg`]: new TextEncoder().encode('<script>alert(1)</script>'),
          [`${ORGANIZACION}/${CLAVE}/mentira.png`]: JPG,
        },
      },
    );
    const salida = await importarProductos(EJECUCION, mundo.puertos);

    expect(salida.codigo).toBe(SALIDA_OK);
    expect(mundo.subidas).toHaveLength(0);
    expect(mundo.estado.get('f1')?.resultado).toBe('aplicada');
  });

  it('omite una imagen de más de 2 MB', async () => {
    const grande = new Uint8Array(2 * 1024 * 1024 + 1);
    grande.set(JPG);
    const mundo = crearPuertos([{ id: 'f1', sku: 'IMG-3', nuevo: true, imagenes: ['grande.jpg'] }], {
      temporales: { [`${ORGANIZACION}/${CLAVE}/grande.jpg`]: grande },
    });
    await importarProductos(EJECUCION, mundo.puertos);
    expect(mundo.subidas).toHaveLength(0);
  });

  it('reintentar la ejecución no duplica productos ni imágenes', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'IMG-4', nuevo: true, imagenes: ['uno.jpg'] }], {
      temporales: { [`${ORGANIZACION}/${CLAVE}/uno.jpg`]: JPG },
    });
    await importarProductos(EJECUCION, mundo.puertos);
    // Segunda corrida (reintento del despacho): las filas ya están resueltas, no queda nada pendiente.
    await importarProductos(EJECUCION, mundo.puertos);
    // Y aun si la base devolviera la fila otra vez, la imagen ya registrada no se duplica.
    const resultado = await mundo.puertos.aplicar(EJECUCION, 'f1');
    expect(resultado.resultado).toBe('aplicada');

    expect(mundo.productos.size).toBe(1);
    expect(mundo.imagenes.size).toBe(1);
  });

  it('si Storage falla, la fila no pierde sus imágenes: el reintento las adjunta sin duplicar', async () => {
    const mundo = crearPuertos(
      [
        { id: 'f1', sku: 'IMG-5', nuevo: true, imagenes: ['uno.jpg', 'dos.png'] },
        { id: 'f2', sku: 'SIN-IMG', nuevo: true },
      ],
      {
        fallasDeSubida: 1,
        temporales: { [`${ORGANIZACION}/${CLAVE}/uno.jpg`]: JPG, [`${ORGANIZACION}/${CLAVE}/dos.png`]: PNG },
      },
    );
    // Primera corrida: la subida falla, el proceso sale con error (el flow reintenta) y la importación NO se cierra.
    await expect(importarProductos(EJECUCION, mundo.puertos)).rejects.toThrow('SUBIDA_FALLIDA');
    expect(mundo.cierres).toEqual([]);
    expect(mundo.imagenesPendientes.has('f1')).toBe(true);
    expect(mundo.borradas).toEqual([]);

    // Reintento: la fila aplicada con imágenes pendientes se vuelve a ofrecer y se completa.
    const salida = await importarProductos(EJECUCION, mundo.puertos);
    expect(salida).toEqual({ codigo: SALIDA_OK });
    expect(mundo.imagenes.size).toBe(2);
    expect(mundo.subidas).toHaveLength(2);
    expect(mundo.productos.size).toBe(2);
    expect(mundo.imagenesPendientes.size).toBe(0);
    expect(mundo.cierres).toEqual([{ importacion: 'terminada' }, { ejecucion: 'exitosa' }]);

    // Una tercera corrida (reintento tardío) no repite nada.
    await importarProductos(EJECUCION, mundo.puertos);
    expect(mundo.imagenes.size).toBe(2);
  });

  it('una imagen no subida (no está en el bucket) se descarta y la fila deja de ofrecerse', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'IMG-6', nuevo: true, imagenes: ['falta.jpg'] }]);
    await importarProductos(EJECUCION, mundo.puertos);
    expect(mundo.imagenesPendientes.size).toBe(0);
    expect(mundo.cierres).toEqual([{ importacion: 'terminada' }, { ejecucion: 'exitosa' }]);
  });

  it('al cerrar la importación borra las imágenes temporales (de a lotes) antes de cerrar la ejecución', async () => {
    const rutas = Array.from({ length: 250 }, (_, i) => `${ORGANIZACION}/${CLAVE}/${i}.jpg`);
    const mundo = crearPuertos([{ id: 'f1', sku: 'X-1', nuevo: true }], { rutasABorrar: rutas });
    await importarProductos(EJECUCION, mundo.puertos);
    expect(mundo.borradas.map((lote) => lote.length)).toEqual([100, 100, 50]);
    expect(mundo.eventos).toContain('limpieza:completada:250 imágenes temporales borradas');
  });

  it('si el borrado de temporales falla, la importación igual termina y la limpieza queda para la próxima corrida', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'X-2', nuevo: true }], { falloLimpieza: true });
    const salida = await importarProductos(EJECUCION, mundo.puertos);
    expect(salida).toEqual({ codigo: SALIDA_OK });
    expect(mundo.cierres).toEqual([{ importacion: 'terminada' }, { ejecucion: 'exitosa' }]);
    expect(mundo.eventos.some((e) => e.startsWith('limpieza:fallida'))).toBe(true);
    expect(mundo.despachos()).toBe(1);
  });

  it('una fila que siempre falla no frena a las demás y se omite al tercer intento', async () => {
    const mundo = crearPuertos(
      [
        { id: 'f1', sku: 'MALA', nuevo: true },
        { id: 'f2', sku: 'BUENA-1', nuevo: true },
        { id: 'f3', sku: 'BUENA-2', nuevo: true },
      ],
      { siempreFallan: ['f1'] },
    );
    // Corridas 1 y 2: las demás se aplican, la mala suma un intento y la corrida falla para que el flow reintente.
    await expect(importarProductos(EJECUCION, mundo.puertos)).rejects.toThrow('FILAS_PENDIENTES');
    expect(mundo.productos.size).toBe(2);
    expect(mundo.cierres).toEqual([]);
    await expect(importarProductos(EJECUCION, mundo.puertos)).rejects.toThrow('FILAS_PENDIENTES');
    // Corrida 3: tercer intento, la base la omite y la importación cierra sin trabarse.
    const salida = await importarProductos(EJECUCION, mundo.puertos);
    expect(salida).toEqual({ codigo: SALIDA_OK });
    expect(mundo.intentos.get('f1')).toBe(3);
    expect(mundo.estado.get('f1')?.resultado).toBe('omitida');
    expect(mundo.estado.get('f2')?.resultado).toBe('aplicada');
    expect(mundo.estado.get('f3')?.resultado).toBe('aplicada');
    expect(mundo.cierres).toEqual([{ importacion: 'terminada' }, { ejecucion: 'exitosa' }]);
  })

  it('las fallas contractuales de aplicar no cuentan como intento de la fila', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'X', nuevo: true }]);
    mundo.puertos.aplicar = async () => {
      throw new Error('EJECUCION_NO_EN_CURSO: x');
    };
    await expect(importarProductos(EJECUCION, mundo.puertos)).rejects.toThrow('EJECUCION_NO_EN_CURSO');
    expect(mundo.intentos.size).toBe(0);
  })

  it('al empezar limpia los huérfanos en tandas acotadas (antes de aplicar) y al cerrar las de la importación', async () => {
    const huerfanos = Array.from({ length: 2500 }, (_, i) => `${ORGANIZACION}/otra/${i}.jpg`);
    const mundo = crearPuertos([{ id: 'f1', sku: 'X-3', nuevo: true }], { rutasHuerfanas: huerfanos, rutasABorrar: [`${ORGANIZACION}/${CLAVE}/a.jpg`] });
    await importarProductos(EJECUCION, mundo.puertos);
    expect(mundo.borradas.flat()).toHaveLength(2501);
    expect(mundo.ordenBorrado.slice(0, 4)).toEqual(['inicio', 'inicio', 'inicio', 'inicio']);
    expect(mundo.ordenBorrado.at(-1)).toBe('cierre');
    // Tope de tandas: nunca más de 5 consultas por fase.
    expect(mundo.ordenBorrado.filter((x) => x === 'inicio').length).toBeLessThanOrEqual(5);
  })

  it('con la ejecución cerrada no actúa y sale con 78 y EJECUCION_NO_EN_CURSO', async () => {
    const mundo = crearPuertos([{ id: 'f1', sku: 'X', nuevo: true }], { enCurso: false });
    const salida = await importarProductos(EJECUCION, mundo.puertos);

    expect(salida).toEqual({ codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${EJECUCION}` });
    expect(mundo.estado.size).toBe(0);
    expect(mundo.cierres).toEqual([]);
    expect(mundo.despachos()).toBe(0);
  });
});

describe('ejecutarDesdeEntorno', () => {
  const entorno = {
    ORGANIZACION_ID: ORGANIZACION,
    EJECUCION_ID: EJECUCION,
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'clave',
  };

  it('sin una variable de entrada sale con 78 y CONFIGURACION_INVALIDA', async () => {
    const mundo = crearPuertos([]);
    const salida = await ejecutarDesdeEntorno({ ...entorno, SUPABASE_URL: undefined, CONEXION_ID: 'con-1' }, () => ({
      puertos: mundo.puertos,
      cerrar: async () => {},
    }));
    expect(salida).toEqual({ codigo: SALIDA_NO_REINTENTABLE, stderr: 'CONFIGURACION_INVALIDA:con-1' });
  });

  it('un EJECUCION_NO_EN_CURSO de la base no se reintenta', async () => {
    const mundo = crearPuertos([]);
    mundo.puertos.iniciar = async () => {
      throw new Error(`EJECUCION_NO_EN_CURSO: ${EJECUCION}`);
    };
    const salida = await ejecutarDesdeEntorno(entorno, () => ({ puertos: mundo.puertos, cerrar: async () => {} }));
    expect(salida).toEqual({ codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${EJECUCION}` });
  });

  it('una falla técnica se propaga para que el flow reintente y siempre cierra el pool', async () => {
    const mundo = crearPuertos([]);
    mundo.puertos.iniciar = async () => {
      throw new Error('conexión caída');
    };
    let cerrado = false;
    await expect(
      ejecutarDesdeEntorno(entorno, () => ({ puertos: mundo.puertos, cerrar: async () => { cerrado = true; } })),
    ).rejects.toThrow('conexión caída');
    expect(cerrado).toBe(true);
  });
});
