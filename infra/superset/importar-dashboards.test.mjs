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
  assert.throws(() => validarReportes({ reportes: [{ nombre: 'X' }] }), /dashboard_uuid/);
  assert.throws(
    () => validarReportes({ reportes: [{ nombre: 'X', dashboard_uuid: UUID_A, seccion: ' ' }] }),
    /sección vacía/,
  );
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
