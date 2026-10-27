import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import {
  ejecutar,
  importarPaquete,
  mapasDeContrasenas,
  registrarReportes,
  resolverEmbebidos,
  validarReportes,
} from './importar-dashboards.mjs';

const script = path.resolve('infra/superset/importar-dashboards.mjs');
const UUID_A = '4e8b1c2d-6f3a-4b5c-8d9e-1a2b3c4d5e6f';
const UUID_B = '7a6b5c4d-3e2f-4a1b-9c8d-0e1f2a3b4c5d';
const CREADO_POR = 'd1000000-0000-0000-0000-000000000001';

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SUPERSET_URL: '', SUPERSET_USERNAME: '', SUPERSET_PASSWORD: '', ...env },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function respuestaJson(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

// Simula Superset (login, CSRF, import) y Supabase (upsert de reportes y de roles).
function servidor(estado) {
  return async (url, opciones = {}) => {
    if (url.endsWith('/api/v1/security/login')) return respuestaJson({ access_token: 'token' });
    if (url.endsWith('/api/v1/security/csrf_token/')) return respuestaJson({ result: 'csrf' });
    if (url.endsWith('/api/v1/dashboard/import/')) {
      estado.imports += 1;
      estado.form = opciones.body;
      return respuestaJson({});
    }
    if (url.includes('/rest/v1/reportes?on_conflict=superset_dashboard_uuid')) {
      const fila = JSON.parse(opciones.body);
      const previa = estado.reportes.get(fila.superset_dashboard_uuid);
      const guardada = { id: previa?.id ?? `reporte-${estado.reportes.size + 1}`, ...fila };
      estado.reportes.set(fila.superset_dashboard_uuid, guardada);
      return respuestaJson([guardada]);
    }
    if (url.includes('/rest/v1/reportes_roles_default?on_conflict=reporte_id,rol_id')) {
      const fila = JSON.parse(opciones.body);
      estado.roles.add(`${fila.reporte_id}|${fila.rol_id}`);
      return respuestaJson([fila]);
    }
    throw new Error(`URL inesperada: ${url}`);
  };
}

function estado() {
  return { imports: 0, form: null, reportes: new Map(), roles: new Set() };
}

async function directorioDePrueba() {
  const directorio = await mkdtemp(path.join(tmpdir(), 'dashboards-import-'));
  await mkdir(path.join(directorio, 'databases'));
  await writeFile(path.join(directorio, 'metadata.yaml'), 'version: 1.0.0\ntype: Dashboard\n');
  await writeFile(
    path.join(directorio, 'databases', 'db.yaml'),
    'sqlalchemy_uri: postgresql+psycopg2://superset:XXXXXXXXXX@${SUPERSET_ANALITICA_DB_HOST}:5432/postgres\n',
  );
  await writeFile(
    path.join(directorio, 'reportes.json'),
    JSON.stringify({
      reportes: [
        { nombre: 'Resumen', dashboard_uuid: UUID_A, seccion: 'rentabilidad', rolesPorDefecto: ['administracion', 'administrador'] },
        { nombre: 'Por producto', dashboard_uuid: UUID_B, seccion: 'rentabilidad', rolesPorDefecto: ['administracion'] },
      ],
    }),
  );
  return directorio;
}

test('rechaza un --entorno inválido antes de tocar el filesystem o la red', async () => {
  const result = await run(['--source', 'cualquier-ruta.zip', '--entorno', 'qa']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /staging\|production/);
});

test('rechaza un --source inexistente antes de autenticar contra Superset', async () => {
  const result = await run(['--source', path.join('infra', 'superset', 'no-existe.zip'), '--entorno', 'staging']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /No se pudo leer el paquete/);
});

test('rechaza cuando falta SUPERSET_URL/USERNAME/PASSWORD', async () => {
  const result = await run(['--source', script, '--entorno', 'staging']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SUPERSET_URL|SUPERSET_USERNAME|SUPERSET_PASSWORD/);
});

test('valida el manifiesto de reportes', () => {
  assert.throws(() => validarReportes({}), /arreglo "reportes"/);
  assert.deepEqual(validarReportes({ reportes: [] }), []);
  assert.throws(() => validarReportes({ reportes: [{ nombre: 'X' }] }), /dashboard_uuid/);
  assert.throws(
    () => validarReportes({ reportes: [{ nombre: 'X', dashboard_uuid: UUID_A, seccion: ' ' }] }),
    /sección vacía/,
  );
  assert.throws(
    () => validarReportes({ reportes: [{ nombre: 'X', dashboard_uuid: UUID_A, filtro_empresa: 'sí' }] }),
    /filtro_empresa.*booleano/,
  );
  assert.equal(
    validarReportes({ reportes: [{ nombre: 'X', dashboard_uuid: UUID_A, filtro_empresa: false }] }).length,
    1,
    'acepta el filtro por empresa como booleano',
  );
});

test('acepta un reporte por dashboard_slug y rechaza uno sin identificar el dashboard', () => {
  assert.equal(validarReportes({ reportes: [{ nombre: 'X', dashboard_slug: 'rentabilidad-resumen' }] }).length, 1);
  assert.throws(() => validarReportes({ reportes: [{ nombre: 'X', dashboard_slug: 'Con Espacios' }] }), /dashboard_slug/);
});

test('mapasDeContrasenas arma el mapa del import solo si hay contraseña', () => {
  assert.equal(mapasDeContrasenas(['databases/db.yaml'], ''), undefined);
  assert.deepEqual(
    mapasDeContrasenas(['databases/db.yaml'], 'clave'),
    { 'databases/db.yaml': 'clave' },
  );
});

test('registrarReportes es idempotente y no asigna administrador', async () => {
  const estadoFalso = estado();
  const fetchFalso = servidor(estadoFalso);
  const reportes = [
    { nombre: 'Resumen', dashboard_uuid: UUID_A, seccion: 'rentabilidad', rolesPorDefecto: ['administracion', 'administrador'] },
  ];
  const config = { supabaseUrl: 'http://supabase.local', serviceRoleKey: 'clave', creadoPor: CREADO_POR };
  const primera = await registrarReportes({ reportes, fetch: fetchFalso, config });
  const segunda = await registrarReportes({ reportes, fetch: fetchFalso, config });
  assert.equal(estadoFalso.reportes.size, 1, 'reimportar no duplica el reporte');
  assert.deepEqual(primera, segunda);
  assert.deepEqual([...estadoFalso.roles], [`${primera[0].id}|administracion`], 'administrador nunca se configura');
  assert.equal(
    estadoFalso.reportes.get(UUID_A).filtro_empresa,
    false,
    'lo que no declara filtro_empresa queda en false (comportamiento anterior)',
  );
});

test('registra filtro_empresa: el tablero declara si el token acota por empresa (FR-004)', async () => {
  const estadoFalso = estado();
  const reportes = [
    { nombre: 'Más vendidos', dashboard_uuid: UUID_A, seccion: 'reportes', filtro_empresa: true },
    { nombre: 'Consolidado', dashboard_uuid: UUID_B, seccion: 'rentabilidad', filtro_empresa: false },
  ];
  await registrarReportes({
    reportes,
    fetch: servidor(estadoFalso),
    config: { supabaseUrl: 'http://supabase.local', serviceRoleKey: 'clave', creadoPor: CREADO_POR },
  });
  assert.equal(estadoFalso.reportes.get(UUID_A).filtro_empresa, true);
  assert.equal(estadoFalso.reportes.get(UUID_B).filtro_empresa, false);
});

test('empaqueta e importa el directorio: pasa la contraseña aparte y registra los reportes', async () => {
  const estadoFalso = estado();
  const directorio = await directorioDePrueba();
  const resultado = await ejecutar({
    args: ['--directorio', directorio, '--entorno', 'staging'],
    fetch: servidor(estadoFalso),
    env: {
      SUPERSET_URL: 'http://superset.local',
      SUPERSET_USERNAME: 'import',
      SUPERSET_PASSWORD: 'secreto',
      SUPERSET_ANALITICA_DB_HOST: 'base.local',
      SUPERSET_ANALITICA_DB_PASSWORD: 'clave-db',
      SUPABASE_URL: 'http://supabase.local',
      SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio',
      SUPERSET_REPORTE_CREADO_POR: CREADO_POR,
    },
  });
  assert.equal(estadoFalso.imports, 1);
  assert.deepEqual(
    JSON.parse(estadoFalso.form.get('passwords')),
    { 'databases/db.yaml': 'clave-db' },
    'la contraseña de la base va en el campo passwords, nunca en Git',
  );
  const paquete = Buffer.from(await estadoFalso.form.get('formData').arrayBuffer());
  assert.match(paquete.toString('utf8'), /base\.local/, 'el host se sustituyó al empaquetar');
  assert.equal(estadoFalso.reportes.size, 2);
  assert.equal(resultado.registrados.length, 2);
});

test('sin credenciales de Supabase importa los dashboards y avisa que no registró reportes', async () => {
  const estadoFalso = estado();
  const directorio = await directorioDePrueba();
  const avisos = [];
  const original = console.warn;
  console.warn = (mensaje) => avisos.push(mensaje);
  try {
    const resultado = await ejecutar({
      args: ['--directorio', directorio, '--entorno', 'staging'],
      fetch: servidor(estadoFalso),
      env: {
        SUPERSET_URL: 'http://superset.local',
        SUPERSET_USERNAME: 'import',
        SUPERSET_PASSWORD: 'secreto',
        SUPERSET_ANALITICA_DB_HOST: 'base.local',
      },
    });
    assert.deepEqual(resultado.registrados, []);
  } finally {
    console.warn = original;
  }
  assert.equal(estadoFalso.imports, 1);
  assert.ok(avisos.some((mensaje) => /no se registraron reportes/.test(mensaje)));
});

test('importarPaquete falla con un paquete vacío antes de pedir credenciales', async () => {
  await assert.rejects(
    () => importarPaquete({ paquete: Buffer.alloc(0), fetch: servidor(estado()), config: {} }),
    /paquete de dashboards está vacío/,
  );
});

function superset(embebidos) {
  const llamadas = [];
  const fetchFalso = async (url, opciones = {}) => {
    llamadas.push(`${opciones.method ?? 'GET'} ${url}`);
    if (url.endsWith('/api/v1/security/login')) return respuestaJson({ access_token: 'token' });
    if (url.endsWith('/api/v1/security/csrf_token/')) return respuestaJson({ result: 'csrf' });
    const coincidencia = url.match(/\/api\/v1\/dashboard\/([^/]+)\/embedded$/);
    if (coincidencia) {
      const slug = decodeURIComponent(coincidencia[1]);
      if (opciones.method === 'POST') {
        embebidos.set(slug, { uuid: UUID_B, dominios: JSON.parse(opciones.body).allowed_domains });
        return respuestaJson({ result: { uuid: UUID_B } });
      }
      return embebidos.has(slug) ? respuestaJson({ result: { uuid: embebidos.get(slug).uuid } }) : respuestaJson({}, 404);
    }
    throw new Error(`URL inesperada ${url}`);
  };
  return { fetchFalso, llamadas };
}

test('resolverEmbebidos habilita el embebido del dashboard por slug y conserva el que ya existe', async () => {
  const config = { supersetUrl: 'http://superset.local', username: 'u', password: 'p' };
  const reportes = [
    { nombre: 'Resumen', dashboard_slug: 'rentabilidad-resumen', seccion: 'rentabilidad' },
    { nombre: 'Fijo', dashboard_uuid: UUID_A },
  ];
  const embebidos = new Map();
  const primera = superset(embebidos);
  const creados = await resolverEmbebidos({ reportes, fetch: primera.fetchFalso, config, dominiosPermitidos: ['http://localhost:3000'] });
  assert.equal(creados[0].dashboard_uuid, UUID_B, 'toma el UUID de embedding que genera Superset');
  assert.equal(creados[1].dashboard_uuid, UUID_A, 'el reporte con UUID fijo no se toca');
  assert.deepEqual(embebidos.get('rentabilidad-resumen').dominios, ['http://localhost:3000']);

  const segunda = superset(embebidos);
  const repetidos = await resolverEmbebidos({ reportes, fetch: segunda.fetchFalso, config });
  assert.equal(repetidos[0].dashboard_uuid, UUID_B, 'idempotente: reusa el embebido existente');
  assert.ok(!segunda.llamadas.some((llamada) => llamada.startsWith('POST') && llamada.includes('/embedded')), 'no vuelve a crearlo');
});

test('resolverEmbebidos no pide nada a Superset si todos los reportes traen su UUID', async () => {
  const { fetchFalso, llamadas } = superset(new Map());
  const reportes = [{ nombre: 'Fijo', dashboard_uuid: UUID_A }];
  assert.deepEqual(await resolverEmbebidos({ reportes, fetch: fetchFalso, config: { supersetUrl: 'http://superset.local' } }), reportes);
  assert.equal(llamadas.length, 0);
});

test('resolverEmbebidos falla con un mensaje claro si Superset no habilita el embebido', async () => {
  const config = { supersetUrl: 'http://superset.local', username: 'u', password: 'p' };
  const fetchFalso = async (url, opciones = {}) => {
    if (url.endsWith('/security/login')) return respuestaJson({ access_token: 'token' });
    if (url.endsWith('/csrf_token/')) return respuestaJson({ result: 'csrf' });
    return opciones.method === 'POST' ? respuestaJson({}, 500) : respuestaJson({}, 404);
  };
  await assert.rejects(
    () => resolverEmbebidos({ reportes: [{ nombre: 'X', dashboard_slug: 'rentabilidad-resumen' }], fetch: fetchFalso, config }),
    /Habilitar el embebido de rentabilidad-resumen devolvió HTTP 500/,
  );
});

test('los YAML versionados de Rentabilidad son coherentes: cada gráfico apunta a un dataset y el reporte a un dashboard', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const raiz = path.resolve('infra/superset/dashboards/rentabilidad');
  const leer = async (...partes) => readFile(path.join(raiz, ...partes), 'utf8');
  const campo = (texto, nombre) => texto.match(new RegExp(`^${nombre}: (.+)$`, 'm'))?.[1].trim();

  const datasets = new Map();
  for (const archivo of await readdir(path.join(raiz, 'datasets', 'Rentabilidad_analitica'))) {
    const texto = await leer('datasets', 'Rentabilidad_analitica', archivo);
    datasets.set(campo(texto, 'uuid'), campo(texto, 'table_name'));
    assert.match(texto, /^- column_name: organizacion_id$/m, `${archivo} expone organizacion_id para el rls del guest token`);
    assert.match(texto, /^schema: analitica$/m, `${archivo} lee solo del esquema analitica`);
    assert.ok(!/mercado/i.test(texto), `${archivo} no menciona Mercado Libre (FR-010)`);
  }

  const charts = new Map();
  for (const archivo of await readdir(path.join(raiz, 'charts'))) {
    const texto = await leer('charts', archivo);
    assert.ok(datasets.has(campo(texto, 'dataset_uuid')), `${archivo} apunta a un dataset versionado`);
    assert.ok(!/mercado/i.test(texto), `${archivo} no menciona Mercado Libre (FR-010)`);
    charts.set(campo(texto, 'uuid'), texto);
  }

  const dashboards = new Map();
  for (const archivo of await readdir(path.join(raiz, 'dashboards'))) {
    const texto = await leer('dashboards', archivo);
    dashboards.set(campo(texto, 'slug'), texto);
  }
  // Cada gráfico aparece en algún dashboard versionado.
  for (const uuidChart of charts.keys()) {
    assert.ok([...dashboards.values()].some((texto) => texto.includes(uuidChart)), `algún dashboard incluye el gráfico ${uuidChart}`);
  }

  const { reportes } = JSON.parse(await leer('reportes.json'));
  assert.deepEqual(
    reportes.map((reporte) => reporte.dashboard_slug).sort(),
    [...dashboards.keys()].sort(),
    'cada dashboard versionado tiene su reporte y viceversa (Resumen y Por producto)',
  );
  for (const reporte of reportes) {
    assert.equal(reporte.seccion, 'rentabilidad');
    assert.ok(!reporte.rolesPorDefecto.includes('administrador'));
  }
});

// F-VTA-22 (FR-003): dataset, tablero «Más vendidos» y su registro en `public.reportes`.
test('los YAML versionados de Ventas · Reportes son coherentes: tabla, filtros nativos y reporte', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const raiz = path.resolve('infra/superset/dashboards/ventas-reportes');
  const leer = async (...partes) => readFile(path.join(raiz, ...partes), 'utf8');
  const campo = (texto, nombre) => texto.match(new RegExp(`^${nombre}: (.+)$`, 'm'))?.[1].trim();

  const datasets = new Map();
  const textosDataset = new Map();
  for (const archivo of await readdir(path.join(raiz, 'datasets', 'Ventas_analitica'))) {
    const texto = await leer('datasets', 'Ventas_analitica', archivo);
    datasets.set(campo(texto, 'uuid'), campo(texto, 'table_name'));
    textosDataset.set(campo(texto, 'uuid'), texto);
    assert.match(texto, /^- column_name: organizacion_id$/m, `${archivo} expone organizacion_id para el rls del guest token`);
    assert.match(texto, /^- column_name: empresa_id$/m, `${archivo} expone empresa_id para el rls por empresa (FR-004)`);
    assert.match(texto, /^schema: analitica$/m, `${archivo} lee solo del esquema analitica`);
    assert.equal(campo(texto, 'table_name'), 'ventas_producto_mas_vendido', 'el dataset lee la vista del contrato');
  }

  const charts = new Map();
  for (const archivo of await readdir(path.join(raiz, 'charts'))) {
    const texto = await leer('charts', archivo);
    assert.ok(datasets.has(campo(texto, 'dataset_uuid')), `${archivo} apunta a un dataset versionado`);
    charts.set(campo(texto, 'uuid'), texto);
  }
  const dashboards = new Map();
  for (const archivo of await readdir(path.join(raiz, 'dashboards'))) {
    const texto = await leer('dashboards', archivo);
    dashboards.set(campo(texto, 'slug'), texto);
  }
  for (const uuidChart of charts.keys()) {
    assert.ok([...dashboards.values()].some((texto) => texto.includes(uuidChart)), `algún dashboard incluye el gráfico ${uuidChart}`);
  }

  // La tabla agrupa por producto y suma: el grano de la vista es empresa × producto × depósito × fecha.
  const grafico = [...charts.values()][0];
  const params = JSON.parse(campo(grafico, 'params'));
  assert.equal(params.viz_type, 'table');
  assert.equal(params.query_mode, 'aggregate');
  assert.deepEqual(params.groupby, ['producto_nombre']);
  for (const metrica of ['posicion', 'unidades_total', 'facturado_total', 'stock_hoy_texto']) {
    assert.ok(params.metrics.includes(metrica), `la tabla muestra ${metrica}`);
  }
  assert.deepEqual(
    params.columns,
    ['producto_nombre', 'posicion', 'unidades_total', 'facturado_total', 'stock_hoy_texto'],
    'las columnas visibles son Producto, #, Unidades, Facturado y Stock hoy',
  );
  const metricas = campo(grafico, 'params');
  assert.ok(metricas.includes('unidades_total'));
  const dataset = textosDataset.get(campo(grafico, 'dataset_uuid'));
  assert.match(dataset, /expression: SUM\(unidades\)/, 'las unidades se suman por producto');
  assert.match(dataset, /expression: SUM\(facturado\)/, 'el facturado se suma por producto');
  assert.match(dataset, /expression: ROW_NUMBER\(\) OVER \(ORDER BY SUM\(unidades\) DESC/, 'la posición es el ranking por unidades');

  // Filtros nativos: rango de fechas, empresa, categoría y ubicación de stock (FR-003).
  const tablero = [...dashboards.values()][0];
  const metadata = JSON.parse(campo(tablero, 'metadata'));
  const filtros = metadata.native_filter_configuration;
  const porNombre = Object.fromEntries(filtros.map((filtro) => [filtro.name, filtro]));
  assert.deepEqual(
    Object.keys(porNombre).sort(),
    ['Categoría', 'Empresa', 'Rango de fechas', 'Ubicación de stock'],
    'los cuatro filtros nativos que pide FR-003',
  );
  assert.equal(porNombre['Rango de fechas'].filterType, 'time_range');
  assert.equal(porNombre['Rango de fechas'].targets[0].column.name, 'fecha');
  assert.equal(porNombre['Empresa'].filterType, 'filter_select');
  assert.equal(porNombre['Empresa'].targets[0].column.name, 'empresa_nombre');
  assert.equal(porNombre['Categoría'].targets[0].column.name, 'categoria');
  assert.equal(porNombre['Ubicación de stock'].targets[0].column.name, 'deposito_nombre');
  for (const filtro of filtros) {
    assert.ok(datasets.has(filtro.targets[0].datasetUuid), `el filtro ${filtro.name} apunta a un dataset versionado`);
  }

  // Cada dashboard versionado tiene su reporte y viceversa, con la sección `reportes`.
  const { reportes } = JSON.parse(await leer('reportes.json'));
  assert.deepEqual(
    reportes.map((reporte) => reporte.dashboard_slug).sort(),
    [...dashboards.keys()].sort(),
    'cada dashboard versionado tiene su reporte y viceversa',
  );
  for (const reporte of reportes) {
    assert.equal(reporte.seccion, 'reportes');
    assert.equal(
      reporte.filtro_empresa,
      true,
      'el tablero expone empresa_id: el token lo acota a las empresas accesibles (FR-004)',
    );
    assert.ok(!reporte.rolesPorDefecto.includes('administrador'));
  }
});

test('el directorio versionado de ventas-reportes se importa y registra el reporte con seccion reportes', async () => {
  const estadoFalso = estado();
  const embebidos = new Map();
  const fetchFalso = async (url, opciones = {}) => {
    if (url.endsWith('/api/v1/security/login')) return respuestaJson({ access_token: 'token' });
    if (url.endsWith('/api/v1/security/csrf_token/')) return respuestaJson({ result: 'csrf' });
    if (url.endsWith('/api/v1/dashboard/import/')) {
      estadoFalso.imports += 1;
      estadoFalso.form = opciones.body;
      return respuestaJson({});
    }
    const coincidencia = url.match(/\/api\/v1\/dashboard\/([^/]+)\/embedded$/);
    if (coincidencia) {
      const slug = decodeURIComponent(coincidencia[1]);
      if (opciones.method === 'POST') {
        embebidos.set(slug, { uuid: UUID_B, dominios: JSON.parse(opciones.body).allowed_domains });
        return respuestaJson({ result: { uuid: UUID_B } });
      }
      return embebidos.has(slug) ? respuestaJson({ result: { uuid: embebidos.get(slug).uuid } }) : respuestaJson({}, 404);
    }
    if (url.includes('/rest/v1/reportes?on_conflict=superset_dashboard_uuid')) {
      const fila = JSON.parse(opciones.body);
      const previa = estadoFalso.reportes.get(fila.superset_dashboard_uuid);
      const guardada = { id: previa?.id ?? `reporte-${estadoFalso.reportes.size + 1}`, ...fila };
      estadoFalso.reportes.set(fila.superset_dashboard_uuid, guardada);
      return respuestaJson([guardada]);
    }
    if (url.includes('/rest/v1/reportes_roles_default?on_conflict=reporte_id,rol_id')) {
      const fila = JSON.parse(opciones.body);
      estadoFalso.roles.add(`${fila.reporte_id}|${fila.rol_id}`);
      return respuestaJson([fila]);
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const entorno = {
    SUPERSET_URL: 'http://superset.local',
    SUPERSET_USERNAME: 'import',
    SUPERSET_PASSWORD: 'secreto',
    SUPERSET_ANALITICA_DB_HOST: 'base.local',
    SUPERSET_ANALITICA_DB_PASSWORD: 'clave-db',
    SUPABASE_URL: 'http://supabase.local',
    SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio',
    SUPERSET_REPORTE_CREADO_POR: CREADO_POR,
  };
  const directorio = path.resolve('infra/superset/dashboards/ventas-reportes');

  const primera = await ejecutar({ args: ['--directorio', directorio, '--entorno', 'staging'], fetch: fetchFalso, env: entorno });
  assert.equal(estadoFalso.imports, 1);
  assert.equal(primera.registrados.length, 1);
  assert.equal(estadoFalso.reportes.size, 1);
  const [fila] = [...estadoFalso.reportes.values()];
  assert.equal(fila.seccion, 'reportes', 'el reporte queda en la sección `reportes`');
  assert.equal(fila.nombre, 'Ventas · Más vendidos');
  assert.equal(fila.filtro_empresa, true, 'el guest token acota el tablero a las empresas accesibles');
  assert.deepEqual([...estadoFalso.roles], [`${fila.id}|administracion`]);

  // La contraseña de la base va en `passwords` y enmascarada en el paquete: nunca en Git.
  assert.deepEqual(
    JSON.parse(estadoFalso.form.get('passwords')),
    { 'databases/Ventas_analitica.yaml': 'clave-db' },
  );
  const paquete = Buffer.from(await estadoFalso.form.get('formData').arrayBuffer());
  assert.match(paquete.toString('utf8'), /base\.local/, 'el host se sustituyó al empaquetar');
  assert.doesNotMatch(paquete.toString('utf8'), /clave-db/);

  // Reimportar no duplica el reporte (idempotencia del registro).
  const segunda = await ejecutar({ args: ['--directorio', directorio, '--entorno', 'staging'], fetch: fetchFalso, env: entorno });
  assert.equal(estadoFalso.reportes.size, 1, 'reimportar no duplica el reporte');
  assert.deepEqual(primera.registrados, segunda.registrados);
});
