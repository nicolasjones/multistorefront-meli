// MSF-908: el barrido de duplicados del board. Cada test fija una regla del barrido: si la
// normalización o el criterio de duplicado cambian, el test que lo vigila falla.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  barrido,
  estaCerrado,
  duplicadosDe,
  familiasPorReferencia,
  formatearInforme,
  gruposPorTitulo,
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
});

describe('evidencia', () => {
  it('un informe de QA/Code/Security/Implementation con contenido es evidencia', () => {
    assert.equal(tieneEvidencia({ fields: [{ name: 'QA Report', value: '## Revisión' }] }), true);
    assert.equal(tieneEvidencia({ fields: [{ name: 'QA Report', value: '   ' }] }), false);
    assert.equal(tieneEvidencia({ fields: [{ name: 'Spec URL', value: 'https://x' }] }), false);
    assert.equal(tieneEvidencia({}), false);
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
});

describe('sin credencial', () => {
  it('el barrido avisa y sale con 0 (no rompe el CI)', () => {
    const entorno = { ...process.env };
    delete entorno.ITSAPLAN_API_KEY;
    const r = spawnSync(process.execPath, ['scripts/auditar-duplicados-tracker.mjs'], {
      encoding: 'utf8',
      env: entorno,
      cwd: process.cwd(),
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Sin ITSAPLAN_API_KEY/);
  });
});
