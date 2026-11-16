// Tableros versionados de la galería «Tableros analíticos» (F-REP-07, MSF-265, spec
// 20261114-100000-analitica-avanzada-y-resumen-por-correo): cada tablero está en YAML en el repo (nunca solo en la UI),
// sale de una vista `analitica` con las columnas que fuerza el guest token, se importa y registra idempotente y el catálogo
// del panel (apps/web/src/lib/tablerosAnaliticos.ts) coincide con reportes.json y la migración 20270324100100.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { empaquetarDashboards } from './empaquetar-dashboards.mjs';
import { ejecutar } from './importar-dashboards.mjs';

const RAIZ = path.resolve('infra/superset/dashboards/analitica-avanzada');
const leer = (...partes) => readFile(path.join(RAIZ, ...partes), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valor = (texto, clave) => texto.match(new RegExp(`^${clave}: (.+)$`, 'm'))?.[1]?.trim();

test('los dos tableros, sus datasets y sus gráficos están versionados en YAML', async () => {
  assert.deepEqual((await readdir(path.join(RAIZ, 'dashboards'))).sort(), ['Margen_real_2.yaml', 'Ventas_tienda_categoria_1.yaml']);
  assert.equal((await readdir(path.join(RAIZ, 'charts'))).length, 6, 'tres gráficos por tablero');
  assert.deepEqual((await readdir(path.join(RAIZ, 'datasets', 'Ventas_analitica'))).sort(), ['margen_real_categoria.yaml', 'ventas_empresa_categoria.yaml']);
});

test('cada dataset sale de una vista analitica y expone las columnas que fuerza el guest token', async () => {
  for (const [archivo, vista] of [['ventas_empresa_categoria.yaml', 'ventas_empresa_categoria'], ['margen_real_categoria.yaml', 'margen_real_categoria']]) {
    const dataset = await leer('datasets', 'Ventas_analitica', archivo);
    assert.equal(valor(dataset, 'table_name'), vista);
    assert.equal(valor(dataset, 'schema'), 'analitica');
    assert.equal(valor(dataset, 'sql'), 'null', 'un dataset físico: nada de SQL libre en el tablero');
    for (const columna of ['organizacion_id', 'empresa_id', 'empresa_nombre', 'categoria', 'producto_nombre', 'sku', 'fecha']) {
      assert.match(dataset, new RegExp(`^- column_name: ${columna}$`, 'm'), `${vista} expone ${columna}`);
    }
    assert.match(dataset, /is_dttm: true/, 'la fecha es la columna temporal del filtro de período');
  }
});

test('el tablero de ventas no muestra costo ni margen; el de margen sí y exige la sección rentabilidad', async () => {
  const ventas = await leer('datasets', 'Ventas_analitica', 'ventas_empresa_categoria.yaml');
  const nombres = ventas.split('\n').filter((linea) => /^\s*-?\s*(column_name|metric_name):/.test(linea)).join('\n');
  assert.doesNotMatch(nombres, /costo|margen|cliente/i);
  const { reportes } = JSON.parse(await leer('reportes.json'));
  const porSlug = Object.fromEntries(reportes.map((reporte) => [reporte.dashboard_slug, reporte]));
  assert.equal(porSlug['analitica-ventas-tienda-categoria'].seccion, 'reportes');
  assert.equal(porSlug['analitica-margen-real'].seccion, 'rentabilidad', 'costo y margen solo con la sección rentabilidad');
  for (const reporte of reportes) {
    assert.equal(reporte.filtro_empresa, true, `${reporte.nombre}: el token acota por empresa`);
    assert.deepEqual(reporte.rolesPorDefecto, ['administracion'], 'administrador no se lista: tiene acceso incondicional');
    assert.match(reporte.nombre, /^Analítica · /, 'el prefijo es la marca que la migración asigna a todas las organizaciones');
  }
});

test('los gráficos apuntan a un dataset del paquete y los tableros solo a gráficos del paquete', async () => {
  const datasets = new Set();
  for (const archivo of await readdir(path.join(RAIZ, 'datasets', 'Ventas_analitica'))) {
    datasets.add(valor(await leer('datasets', 'Ventas_analitica', archivo), 'uuid'));
  }
  const graficos = new Set();
  for (const archivo of await readdir(path.join(RAIZ, 'charts'))) {
    const texto = await leer('charts', archivo);
    assert.ok(datasets.has(valor(texto, 'dataset_uuid')), `${archivo}: dataset del paquete`);
    assert.match(texto, /"datasource": "1__table"/);
    graficos.add(valor(texto, 'uuid'));
  }
  assert.equal(graficos.size, 6);
  for (const archivo of await readdir(path.join(RAIZ, 'dashboards'))) {
    const texto = await leer('dashboards', archivo);
    assert.match(valor(texto, 'uuid'), UUID);
    const usados = [...texto.matchAll(/"uuid": "([0-9a-f-]{36})"/g)].map((m) => m[1]);
    assert.equal(usados.length, 3, `${archivo}: tres gráficos`);
    for (const uuid of usados) assert.ok(graficos.has(uuid), `${archivo}: ${uuid} es un gráfico del paquete`);
    // Los filtros que preselecciona el panel (período y empresa) tienen el id y la columna que el panel espera.
    assert.match(texto, /"id": "NATIVE_FILTER-rango"/);
    assert.match(texto, /"id": "NATIVE_FILTER-empresa".*?"filterType": "filter_select"/);
    assert.match(texto, /"name": "empresa_nombre"/);
    assert.match(texto, /filter_timegrain/);
  }
});

test('empaqueta el directorio real sin credenciales y sin reportes.json', async () => {
  const paquete = await empaquetarDashboards({ directorio: RAIZ, variables: { SUPERSET_ANALITICA_DB_HOST: 'base-de-la-app' } });
  const texto = paquete.toString('latin1');
  assert.doesNotMatch(texto, /reportes\.json/);
  assert.match(texto, /XXXXXXXXXX/);
  assert.doesNotMatch(texto, /\$\{SUPERSET_ANALITICA_DB_HOST\}/);
});

test('el catálogo del panel coincide con reportes.json y con la migración que asigna los tableros', async () => {
  const { reportes } = JSON.parse(await leer('reportes.json'));
  const catalogo = await readFile('apps/web/src/lib/tablerosAnaliticos.ts', 'utf8');
  const migracion = await readFile('supabase/migrations/20270324100100_reportes_tableros_analiticos.sql', 'utf8');
  for (const reporte of reportes) {
    assert.ok(catalogo.includes(`'${reporte.nombre}'`), `el catálogo del panel lista «${reporte.nombre}»`);
    assert.ok(migracion.includes(`'${reporte.nombre}'`), `la migración registra «${reporte.nombre}»`);
    assert.ok(migracion.includes(`'${reporte.seccion}'`));
  }
});

test('el paquete se importa y registra los dos tableros (idempotente) con su sección y el filtro por empresa', async () => {
  const filas = new Map();
  const roles = new Set();
  const respuesta = (cuerpo, status = 200) => ({ ok: status < 400, status, headers: { getSetCookie: () => [] }, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });
  let imports = 0;
  const embebidos = new Map();
  let form;
  const fetchFalso = async (url, opciones = {}) => {
    if (url.endsWith('/api/v1/security/login')) return respuesta({ access_token: 'token' });
    if (url.endsWith('/api/v1/security/csrf_token/')) return respuesta({ result: 'csrf' });
    if (url.endsWith('/api/v1/dashboard/import/')) { imports += 1; form = opciones.body; return respuesta({}); }
    if (/\/api\/v1\/dashboard\/([^/]+)\/embedded$/.test(url)) {
      const slug = url.match(/dashboard\/([^/]+)\/embedded/)[1];
      if (opciones.method === 'POST') {
        embebidos.set(slug, `00000000-0000-4000-8000-${String(embebidos.size + 1).padStart(12, '0')}`);
      }
      return embebidos.has(slug) ? respuesta({ result: { uuid: embebidos.get(slug) } }) : respuesta({}, 404);
    }
    if (url.includes('/rest/v1/reportes?nombre=eq.')) return respuesta([]);
    if (url.includes('/rest/v1/reportes?on_conflict=superset_dashboard_uuid')) {
      const fila = JSON.parse(opciones.body);
      const guardada = { id: filas.get(fila.superset_dashboard_uuid)?.id ?? `reporte-${filas.size + 1}`, ...fila };
      filas.set(fila.superset_dashboard_uuid, guardada);
      return respuesta([guardada]);
    }
    if (url.includes('/rest/v1/reportes_roles_default?on_conflict=reporte_id,rol_id')) {
      const fila = JSON.parse(opciones.body);
      roles.add(`${fila.reporte_id}|${fila.rol_id}`);
      return respuesta([fila]);
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  const entorno = {
    SUPERSET_URL: 'http://superset.local', SUPERSET_USERNAME: 'import', SUPERSET_PASSWORD: 'secreto',
    SUPERSET_ANALITICA_DB_HOST: 'base.local', SUPERSET_ANALITICA_DB_PASSWORD: 'clave-db',
    SUPABASE_URL: 'http://supabase.local', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio',
    SUPERSET_REPORTE_CREADO_POR: '11111111-1111-4111-8111-111111111111',
  };
  const primera = await ejecutar({ args: ['--directorio', RAIZ, '--entorno', 'staging'], fetch: fetchFalso, env: entorno });
  assert.equal(imports, 1);
  assert.equal(primera.registrados.length, 2);
  const registradas = [...filas.values()];
  assert.deepEqual(registradas.map((fila) => fila.nombre).sort(), [
    'Analítica · Margen real por tienda, categoría y producto',
    'Analítica · Ventas por tienda y categoría',
  ]);
  assert.ok(registradas.every((fila) => fila.filtro_empresa === true));
  assert.deepEqual(registradas.map((fila) => fila.seccion).sort(), ['rentabilidad', 'reportes']);
  assert.ok(registradas.every((fila) => roles.has(`${fila.id}|administracion`) && !roles.has(`${fila.id}|administrador`)));
  const paquete = Buffer.from(await form.get('formData').arrayBuffer());
  assert.doesNotMatch(paquete.toString('utf8'), /clave-db/);
  await ejecutar({ args: ['--directorio', RAIZ, '--entorno', 'staging'], fetch: fetchFalso, env: entorno });
  assert.equal(filas.size, 2, 'reimportar no duplica los reportes');
});
