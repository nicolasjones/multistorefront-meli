// MSF-908: el barrido de duplicados del board. Cada test fija una regla del barrido: si la
// normalización o el criterio de duplicado cambian, el test que lo vigila falla.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  barrido,
  cargarDetalles,
  conReintentos,
  estaCerrado,
  duplicadosDe,
  familiasPorReferencia,
  formatearInforme,
  gruposPorTitulo,
  leerBoard,
  resolverApi,
  TOPE_LECTURA,
  normalizarTitulo,
  referenciaTitulo,
  sinCierreAdministrativo,
  tieneEvidencia,
} from './auditar-duplicados-tracker.mjs';

const COLUMNAS_CERRADAS = new Set([51, 58]);
const ID_CIERRE_ADMINISTRATIVO = 585;

const item = (over = {}) => ({
  id: 1,
  identifier: 'MSF-000',
  title: 'Título',
  parentId: 10,
  columnId: 11,
  typeId: 22,
  labelIds: [],
  ...over,
});

describe('normalización del título', () => {
  it('conserva la etiqueta inicial: dos épicas con el mismo texto NO se funden', () => {
    assert.notEqual(
      normalizarTitulo('[Cierre MSF-212] Última fase (T070, T071, T072)'),
      normalizarTitulo('[Cierre MSF-191] Última fase (T070, T071, T072)'),
    );
  });

  it('el texto sin etiqueta se normaliza igual (minúsculas, sin signos, espacios colapsados)', () => {
    assert.equal(normalizarTitulo('  Última   FASE, (T070)!  '), 'ultima fase t070');
    assert.equal(normalizarTitulo('Verificación'), 'verificacion');
  });

  it('dos títulos con la misma etiqueta y el mismo texto colapsan en un grupo', () => {
    const grupos = gruposPorTitulo([
      item({ id: 1, identifier: 'MSF-476', title: '[MSF-470] Bloqueo de acceso server-side (Auth Hook)' }),
      item({ id: 2, identifier: 'MSF-477', title: '[MSF-470] Bloqueo de acceso server-side (Auth Hook)' }),
    ]);
    assert.equal(grupos.size, 1);
    assert.equal(grupos.get(normalizarTitulo('[MSF-470] Bloqueo de acceso server-side (Auth Hook)')).length, 2);
  });
});

describe('referencia de la etiqueta inicial', () => {
  it('toma la referencia cuando la etiqueta apunta a un ítem', () => {
    assert.equal(referenciaTitulo('[Seg. MSF-470] Cerrar el oráculo'), 'seg. msf-470');
    assert.equal(referenciaTitulo('[MSF-470] Bloqueo'), 'msf-470');
  });

  it('ignora las etiquetas de tipo (no son referencias: las comparten decenas de ítems)', () => {
    assert.equal(referenciaTitulo('[Bug] Un fallo'), null);
    assert.equal(referenciaTitulo('[Auditoría] 12 pares'), null);
    assert.equal(referenciaTitulo('Sin etiqueta'), null);
  });
});

describe('duplicados por título', () => {
  const titulos = [
    item({ id: 1, identifier: 'MSF-476', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
    item({ id: 2, identifier: 'MSF-477', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
    item({ id: 3, identifier: 'MSF-557', title: '[Cierre MSF-212] Última fase', parentId: 212, columnId: 11 }),
    item({ id: 4, identifier: 'MSF-558', title: '[Cierre MSF-191] Última fase', parentId: 191, columnId: 11 }),
  ];

  it('marca como duplicado real sólo a los que comparten padre', () => {
    const informe = barrido(titulos, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    const grupo = informe.titulos.find((g) => g.miembros.some((m) => m.identifier === 'MSF-476'));
    assert.equal(grupo.miembros.length, 2);
    assert.deepEqual(
      grupo.mismosPadres.flat().map((m) => m.identifier),
      ['MSF-476', 'MSF-477'],
    );
  });

  it('no reporta como grupo a los ítems de épicas distintas (falsos positivos del barrido viejo)', () => {
    const informe = barrido(titulos, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    assert.equal(informe.titulos.length, 1);
    assert.equal(informe.titulos[0].mismosPadres.length, 1);
  });

  it('familias por referencia + mismo padre, aunque los títulos difieran', () => {
    const familias = familiasPorReferencia([
      item({ id: 1, title: '[Seg. MSF-470] Cerrar el oráculo de existencia de correo' }),
      item({ id: 2, title: '[Seg. MSF-470] Cerrar oráculo de enumeración de correos' }),
      item({ id: 3, title: '[Seg. MSF-470] Otro hallazgo', parentId: 999 }),
    ]);
    const delPadre = familias.get('seg. msf-470|10');
    assert.equal(delPadre.length, 2);
  });

  it('compartir referencia NO es motivo para cerrar: los ítems de una familia no se marcan por unificar', () => {
    const familia = [
      item({ id: 1, identifier: 'MSF-524', title: '[Seguimiento MSF-205] «Compra para» en el proveedor', parentId: 372, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-525', title: '[Seguimiento MSF-205] «Enviar correo a proveedor»', parentId: 372, columnId: 51 }),
    ];
    const informe = barrido(familia, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: () => true,
    });
    assert.equal(informe.familias.length, 1);
    assert.equal(informe.sinCierre.length, 0);
    assert.equal(informe.sinMecanismo.length, 0);
  });
});

describe('lectura del board y detalle', () => {
  it('lee el board completo, incluidos los ítems sin tipo, y suma los archivados', async () => {
    const rutas = [];
    const pedir = async (ruta) => {
      rutas.push(ruta);
      if (ruta === '/projects/MSF') return { columns: [], labels: [], issueTypes: [] };
      if (ruta === '/projects/MSF/issues/board') {
        return { issues: [item({ id: 1, typeId: 22 }), item({ id: 2, identifier: 'MSF-931', typeId: null })] };
      }
      if (ruta === '/projects/MSF/issues/archived') return [item({ id: 3, identifier: 'MSF-003', typeId: null })];
      throw new Error(`ruta inesperada: ${ruta}`);
    };
    const { items, activos, archivados } = await leerBoard({ pedir, proyecto: 'MSF' });
    assert.deepEqual(items.map((i) => i.id).sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(activos, 2);
    assert.equal(archivados, 1);
    assert.ok(items.some((i) => i.typeId === null));
    assert.ok(rutas.includes('/projects/MSF/issues/board'));
    assert.ok(rutas.includes('/projects/MSF/issues/archived'));
    assert.ok(!rutas.some((ruta) => ruta.includes('typeId=')));
  });

  it('pide el detalle de todos los ítems, no sólo de los que caen en un grupo', async () => {
    const items = [item({ id: 1, title: 'Uno' }), item({ id: 2, title: 'Dos' }), item({ id: 3, title: 'Tres' })];
    const pedidos = [];
    const detalles = await cargarDetalles(items, async (id) => {
      pedidos.push(id);
      return { id };
    });
    assert.deepEqual(pedidos.sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(detalles.size, 3);
  });
});

describe('unión de los dos endpoints del board', () => {
  const pedir = (board, archivados) => async (ruta) => {
    if (ruta === '/projects/MSF') return { columns: [], labels: [] };
    if (ruta === '/projects/MSF/issues/board') return board;
    if (ruta === '/projects/MSF/issues/archived') return archivados;
    throw new Error(`ruta inesperada: ${ruta}`);
  };

  it('un ítem que aparece en el board y en el archivado se cuenta una sola vez (por identifier)', async () => {
    // El mismo ítem llega con `id` distinto en cada endpoint: unir por `id` lo metía dos veces y
    // el barrido lo citaba como duplicado de sí mismo ("MSF-472, MSF-472").
    const { items, activos, archivados } = await leerBoard({
      pedir: pedir(
        { issues: [item({ id: 640, identifier: 'MSF-472', title: 'Un título' })] },
        [item({ id: 999, identifier: 'MSF-472', title: 'Un título' })],
      ),
      proyecto: 'MSF',
    });
    assert.deepEqual(items.map((i) => i.identifier), ['MSF-472']);
    assert.equal(activos, 1);
    assert.equal(archivados, 0);
  });

  it('tolera las formas conocidas de la respuesta (array, {issues} y {data})', async () => {
    const { items } = await leerBoard({
      pedir: pedir({ data: [item({ id: 1, identifier: 'MSF-1' })] }, [item({ id: 2, identifier: 'MSF-2' })]),
      proyecto: 'MSF',
    });
    assert.deepEqual(items.map((i) => i.identifier), ['MSF-1', 'MSF-2']);
  });

  it('falla ruidosamente si el board viene vacío (no es un board limpio)', async () => {
    await assert.rejects(
      () => leerBoard({ pedir: pedir({ issues: [] }, []), proyecto: 'MSF' }),
      /0 ítems leídos/,
    );
  });

  it('falla si /issues/board o /issues/archived llegan al tope (lectura posiblemente truncada)', async () => {
    const lleno = (desde) => Array.from({ length: TOPE_LECTURA }, (_, i) => item({ id: desde + i, identifier: `MSF-${desde + i}` }));
    await assert.rejects(() => leerBoard({ pedir: pedir({ issues: lleno(1) }, []), proyecto: 'MSF' }), /\/issues\/board.*truncada/);
    await assert.rejects(() => leerBoard({ pedir: pedir({ issues: [item({ id: 9 })] }, lleno(1000)), proyecto: 'MSF' }), /\/issues\/archived.*truncada/);
  });

  it('ITSAPLAN_API_URL sólo acepta el host por defecto, salvo --permitir-otra-api', () => {
    assert.equal(resolverApi({ valor: undefined }), 'https://api.plan.agenmatica.com');
    assert.equal(resolverApi({ valor: 'https://api.plan.agenmatica.com/' }), 'https://api.plan.agenmatica.com');
    assert.throws(() => resolverApi({ valor: 'https://evil.test' }), /otro host/);
    const avisos = [];
    assert.equal(resolverApi({ valor: 'https://otro.test/', args: ['--permitir-otra-api'], aviso: (m) => avisos.push(m) }), 'https://otro.test');
    assert.equal(avisos.length, 1);
  });

  it('falla si la respuesta del board tiene otra forma (no inventa un board vacío)', async () => {
    await assert.rejects(
      () => leerBoard({ pedir: pedir({ issues: { nope: true } }, []), proyecto: 'MSF' }),
      /respuesta inesperada/,
    );
  });
});

describe('reintentos de la lectura', () => {
  it('reintenta un fallo transitorio y sigue', async () => {
    let intentos = 0;
    const resultado = await conReintentos(
      async () => {
        intentos += 1;
        if (intentos < 3) {
          const error = new Error('ItsAPlan: 429');
          error.status = 429;
          throw error;
        }
        return 'ok';
      },
      { espera: 1 },
    );
    assert.equal(resultado, 'ok');
    assert.equal(intentos, 3);
  });

  it('un fallo permanente (404) no se reintenta', async () => {
    let intentos = 0;
    await assert.rejects(
      () =>
        conReintentos(
          async () => {
            intentos += 1;
            const error = new Error('ItsAPlan: 404');
            error.status = 404;
            throw error;
          },
          { espera: 1 },
        ),
      /404/,
    );
    assert.equal(intentos, 1);
  });

  it('cargarDetalles sobrevive a un 429 y trae el detalle de todos los ítems', async () => {
    let pedidos = 0;
    const detalles = await cargarDetalles([item({ id: 1 }), item({ id: 2 })], async (id) => {
      pedidos += 1;
      if (id === 1 && pedidos === 1) {
        const error = new Error('ItsAPlan: 429');
        error.status = 429;
        throw error;
      }
      return { id };
    });
    assert.equal(detalles.size, 2);
    assert.ok(pedidos >= 3);
  });
});

describe('cierre administrativo', () => {
  const cerrados = [
    item({ id: 1, identifier: 'MSF-476', title: '[MSF-470] Bloqueo', columnId: 51, labelIds: [649] }),
    item({ id: 2, identifier: 'MSF-477', title: '[MSF-470] Bloqueo', columnId: 51, labelIds: [648] }),
  ];

  it('un item cerrado sin `cierre-administrativo` cuyo gemelo tiene evidencia se reporta', () => {
    const informe = barrido(cerrados, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) => i.identifier === 'MSF-477',
    });
    assert.equal(informe.sinCierre.length, 1);
    assert.equal(informe.sinCierre[0].item.identifier, 'MSF-476');
    assert.deepEqual(informe.sinCierre[0].gemelos.map((g) => g.identifier), ['MSF-477']);
  });

  it('no cuenta un Implementation Report «terminó sin PR» como evidencia del gemelo', () => {
    const informe = barrido(cerrados, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) =>
        tieneEvidencia({ fields: [{ name: 'Implementation Report', value: `## Fix ${i.identifier} — terminó sin PR` }] }),
    });
    assert.equal(informe.sinCierre.length, 0);
  });

  it('con el label aplicado ya no se reporta', () => {
    const conLabel = cerrados.map((i) => (i.identifier === 'MSF-476' ? { ...i, labelIds: [649, 585] } : i));
    const informe = barrido(conLabel, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) => i.identifier === 'MSF-477',
    });
    assert.equal(informe.sinCierre.length, 0);
  });

  it('un item abierto no se reporta aunque su gemelo tenga evidencia', () => {
    const abierto = cerrados.map((i) => (i.identifier === 'MSF-476' ? { ...i, columnId: 11 } : i));
    const informe = barrido(abierto, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) => i.identifier === 'MSF-477',
    });
    assert.equal(informe.sinCierre.length, 0);
  });

  it('el ítem que conserva la entrega no se marca cuando su gemelo ya se cerró administrativamente', () => {
    // Ambos tienen registro (el duplicado también): sin la exclusión, el que conserva la
    // entrega aparecería como "por unificar" y el barrido no dejaría limpio el board.
    const conRegistro = cerrados.map((i) => (i.identifier === 'MSF-476' ? { ...i, labelIds: [649, 585] } : i));
    const informe = barrido(conRegistro, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: () => true,
    });
    assert.equal(informe.sinCierre.length, 0);
    assert.equal(informe.sinCierre.some((c) => c.item.identifier === 'MSF-477'), false);
  });

  it('detecta el label por id y la columna cerrada por stateType', () => {
    assert.equal(sinCierreAdministrativo({ labelIds: [649] }, ID_CIERRE_ADMINISTRATIVO), true);
    assert.equal(sinCierreAdministrativo({ labelIds: [649, 585] }, ID_CIERRE_ADMINISTRATIVO), false);
    assert.equal(estaCerrado({ columnId: 51 }, COLUMNAS_CERRADAS), true);
    assert.equal(estaCerrado({ columnId: 11 }, COLUMNAS_CERRADAS), false);
  });

  it('un par duplicado sin padre en los dos se reporta en C (no sólo el de mismo padre)', () => {
    const sinPadre = [
      item({ id: 1, identifier: 'MSF-900', title: 'Un re-reporte', parentId: null, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-901', title: 'Un re-reporte', parentId: null, columnId: 51 }),
    ];
    const informe = barrido(sinPadre, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) => i.identifier === 'MSF-901',
    });
    assert.equal(informe.sinCierre.length, 1);
    assert.equal(informe.sinCierre[0].item.identifier, 'MSF-900');
  });

  it('un re-reporte sin padre y su par con padre se reportan en C', () => {
    const reReporte = [
      item({ id: 1, identifier: 'MSF-859', title: 'Seguimiento CI', parentId: 881, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-931', title: 'Seguimiento CI', parentId: null, columnId: 51 }),
    ];
    const informe = barrido(reReporte, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: (i) => i.identifier === 'MSF-931',
    });
    assert.equal(informe.sinCierre.length, 1);
    assert.equal(informe.sinCierre[0].item.identifier, 'MSF-859');
    assert.deepEqual(informe.sinCierre[0].gemelos.map((g) => g.identifier), ['MSF-931']);
  });

  it('dos ítems con padres distintos NO son par duplicado: no se reportan en C', () => {
    const deEpis = [
      item({ id: 1, identifier: 'MSF-557', title: 'Última fase', parentId: 212, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-558', title: 'Última fase', parentId: 191, columnId: 51 }),
    ];
    const informe = barrido(deEpis, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      evidencia: () => true,
    });
    assert.equal(informe.sinCierre.length, 0);
  });
});

describe('unificación con la relación `duplicates`', () => {
  const relaciones = (i) =>
    i.identifier === 'MSF-476'
      ? [{ kind: 'duplicates', direction: 'outward', issue: { identifier: 'MSF-477' } }]
      : [];

  it('un ítem que ya duplica a otro pero no tiene `cierre-administrativo` se reporta', () => {
    const items = [item({ id: 1, identifier: 'MSF-476', labelIds: [649] })];
    const informe = barrido(items, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      relaciones,
    });
    assert.equal(informe.sinMecanismo.length, 1);
    assert.deepEqual(informe.sinMecanismo[0].duplica, ['MSF-477']);
  });

  it('con el label aplicado ya no se reporta', () => {
    const items = [item({ id: 1, identifier: 'MSF-476', labelIds: [649, 585] })];
    const informe = barrido(items, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      relaciones,
    });
    assert.equal(informe.sinMecanismo.length, 0);
  });

  it('sólo cuenta la relación hacia afuera (la del ítem duplicado)', () => {
    const inbound = [{ kind: 'duplicates', direction: 'inward', issue: { identifier: 'MSF-476' } }];
    assert.deepEqual(duplicadosDe({ identifier: 'MSF-477' }, () => inbound), []);
    assert.deepEqual(duplicadosDe({ identifier: 'MSF-477' }, () => inbound.concat(inbound)), []);
  });

  it('la sección D cubre cualquier ítem con `duplicates`, aunque no comparta título', () => {
    const items = [item({ id: 1, identifier: 'MSF-606', title: 'Un título único', labelIds: [] })];
    const relaciones = (i) =>
      i.identifier === 'MSF-606'
        ? [{ kind: 'duplicates', direction: 'outward', issue: { identifier: 'MSF-597' } }]
        : [];
    const informe = barrido(items, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      relaciones,
    });
    assert.equal(informe.sinMecanismo.length, 1);
    assert.equal(informe.sinMecanismo[0].item.identifier, 'MSF-606');
  });
});

describe('evidencia', () => {
  it('un informe de QA/Code/Security con contenido es evidencia', () => {
    assert.equal(tieneEvidencia({ fields: [{ name: 'QA Report', value: '## Revisión' }] }), true);
    assert.equal(tieneEvidencia({ fields: [{ name: 'QA Report', value: '   ' }] }), false);
    assert.equal(tieneEvidencia({ fields: [{ name: 'Spec URL', value: 'https://x' }] }), false);
    assert.equal(tieneEvidencia({}), false);
  });

  it('el Implementation Report sólo es evidencia si no declara que no entregó', () => {
    assert.equal(
      tieneEvidencia({ fields: [{ name: 'Implementation Report', value: '## 🧱 Implementación MSF-835 — PR listo' }] }),
      true,
    );
    assert.equal(
      tieneEvidencia({ fields: [{ name: 'Implementation Report', value: '## ♻️ Fix MSF-802 — correcciones aplicadas' }] }),
      true,
    );
    assert.equal(
      tieneEvidencia({ fields: [{ name: 'Implementation Report', value: '## ⚠️ Fix MSF-471 — terminó sin PR' }] }),
      false,
    );
    assert.equal(
      tieneEvidencia({ fields: [{ name: 'Implementation Report', value: '## ⛔ Fix MSF-860 — falló el Desarrollador' }] }),
      false,
    );
  });

  it('el estado se lee del título del informe, no del cuerpo', () => {
    // El cuerpo puede hablar de otro PR: lo que decide es el estado que escribió el flujo.
    const valor = '## ⚠️ Implementación MSF-115 — terminó sin PR\n\nEl PR https://github.com/x/y/pull/266 ya estaba mergeado.';
    assert.equal(tieneEvidencia({ fields: [{ name: 'Implementation Report', value: valor }] }), false);
  });
});

describe('informe', () => {
  it('el resumen cuenta los duplicados reales y las familias', () => {
    const items = [
      item({ id: 1, identifier: 'MSF-476', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-477', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
    ];
    const informe = barrido(items, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    const texto = formatearInforme(informe, {
      proyecto: 'MSF',
      leidos: items.length,
      nombresPorId: new Map([[283, 'MSF-119']]),
      nombresColumna: new Map([[51, 'Review In DEV']]),
      nombresEtiqueta: new Map([[649, 'seguimiento']]),
    });
    assert.match(texto, /DUPLICADO REAL \(mismo padre\): MSF-476, MSF-477/);
    assert.match(texto, /1 grupo\(s\) con título idéntico · 1 duplicado\(s\) real\(es\) \(1 sin unificar\)/);
  });

  it('marca el par como ya unificado cuando está la relación `duplicates`', () => {
    const items = [
      item({ id: 1, identifier: 'MSF-476', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-477', title: '[MSF-470] Bloqueo', parentId: 283, columnId: 51 }),
    ];
    const relaciones = (i) =>
      i.identifier === 'MSF-476'
        ? [{ kind: 'duplicates', direction: 'outward', issue: { identifier: 'MSF-477' } }]
        : [];
    const informe = barrido(items, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      relaciones,
    });
    const texto = formatearInforme(informe, { leidos: items.length });
    assert.match(texto, /DUPLICADO REAL \(mismo padre\): MSF-476, MSF-477 — ya unificado \(MSF-476 → MSF-477\)/);
    assert.match(texto, /1 duplicado\(s\) real\(es\) \(0 sin unificar\)/);
  });

  it('un mismo título con un ítem sin padre se reporta como candidato a duplicado', () => {
    const items = [
      item({ id: 1, identifier: 'MSF-859', title: 'Seguimiento CI', parentId: 881, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-931', title: 'Seguimiento CI', parentId: null, columnId: 51 }),
    ];
    const informe = barrido(items, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    const texto = formatearInforme(informe, { leidos: 2, activos: 2, archivados: 0 });
    assert.match(texto, /CANDIDATO A DUPLICADO: MSF-931 \(mismo título, sin padre\) — revisar si duplica a MSF-859/);
    assert.match(texto, /1 candidato\(s\) sin padre/);
    assert.doesNotMatch(texto, /falsos positivos/);
    assert.match(texto, /2 ítems leídos \(2 activos \+ 0 archivados\)/);
  });

  it('mismo título con padres distintos y con padre en los dos NO es candidato (es un ítem por épica)', () => {
    const items = [
      item({ id: 1, identifier: 'MSF-557', title: 'Última fase', parentId: 212, columnId: 11 }),
      item({ id: 2, identifier: 'MSF-558', title: 'Última fase', parentId: 191, columnId: 11 }),
    ];
    const informe = barrido(items, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    const texto = formatearInforme(informe, { leidos: 2 });
    assert.match(texto, /falsos positivos: padres distintos \(un ítem por épica\)/);
    assert.doesNotMatch(texto, /CANDIDATO A DUPLICADO/);
    assert.match(texto, /0 candidato\(s\) sin padre/);
  });

  it('marca el candidato como ya unificado cuando el ítem sin padre duplica al otro', () => {
    const items = [
      item({ id: 1, identifier: 'MSF-859', title: 'Seguimiento CI', parentId: 881, columnId: 51 }),
      item({ id: 2, identifier: 'MSF-931', title: 'Seguimiento CI', parentId: null, columnId: 51 }),
    ];
    const relaciones = (i) =>
      i.identifier === 'MSF-859'
        ? [{ kind: 'duplicates', direction: 'outward', issue: { identifier: 'MSF-931' } }]
        : [];
    const informe = barrido(items, {
      columnasCerradas: COLUMNAS_CERRADAS,
      idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
      relaciones,
    });
    const texto = formatearInforme(informe, { leidos: 2 });
    assert.match(texto, /CANDIDATO A DUPLICADO: MSF-931 \(mismo título, sin padre\) — ya unificado \(MSF-859 → MSF-931\)/);
  });

  it('la línea de candidato nombra al que no tiene padre y contra cuál puede duplicar', () => {
    // Con un par del mismo padre y un re-reporte sin padre: el candidato es el que no tiene
    // padre y el par del mismo padre es una de sus posibles contrapartes.
    const items = [
      item({ id: 1, identifier: 'MSF-A', title: 'Un título', parentId: 10, columnId: 11 }),
      item({ id: 2, identifier: 'MSF-B', title: 'Un título', parentId: 10, columnId: 11 }),
      item({ id: 3, identifier: 'MSF-C', title: 'Un título', parentId: null, columnId: 11 }),
    ];
    const informe = barrido(items, { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO });
    const texto = formatearInforme(informe, { leidos: 3 });
    assert.match(texto, /CANDIDATO A DUPLICADO: MSF-C \(mismo título, sin padre\) — revisar si duplica a MSF-A, MSF-B/);
  });

  it('el resumen distingue el candidato pendiente del ya unificado', () => {
    const pendiente = barrido(
      [
        item({ id: 1, identifier: 'MSF-859', title: 'Seguimiento CI', parentId: 881, columnId: 51 }),
        item({ id: 2, identifier: 'MSF-931', title: 'Seguimiento CI', parentId: null, columnId: 51 }),
      ],
      { columnasCerradas: COLUMNAS_CERRADAS, idLabelCierre: ID_CIERRE_ADMINISTRATIVO },
    );
    const texto = formatearInforme(pendiente, { leidos: 2 });
    assert.match(texto, /1 candidato\(s\) sin padre \(1 sin unificar\)/);

    const unificado = barrido(
      [
        item({ id: 1, identifier: 'MSF-859', title: 'Seguimiento CI', parentId: 881, columnId: 51 }),
        item({ id: 2, identifier: 'MSF-931', title: 'Seguimiento CI', parentId: null, columnId: 51 }),
      ],
      {
        columnasCerradas: COLUMNAS_CERRADAS,
        idLabelCierre: ID_CIERRE_ADMINISTRATIVO,
        relaciones: (i) =>
          i.identifier === 'MSF-859'
            ? [{ kind: 'duplicates', direction: 'outward', issue: { identifier: 'MSF-931' } }]
            : [],
      },
    );
    const textoUnificado = formatearInforme(unificado, { leidos: 2 });
    assert.match(textoUnificado, /1 candidato\(s\) sin padre \(0 sin unificar\)/);
  });
});

describe('sin credencial', () => {
  it('el barrido avisa y sale con 0 (no rompe el CI)', () => {
    const entorno = { ...process.env };
    delete entorno.ITSAPLAN_API_KEY;
    const script = fileURLToPath(new URL('./auditar-duplicados-tracker.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: entorno });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Sin ITSAPLAN_API_KEY/);
  });
});
