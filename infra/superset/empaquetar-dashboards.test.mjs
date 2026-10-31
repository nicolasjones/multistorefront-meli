import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  conexionesDelDirectorio,
  crearZip,
  empaquetarDashboards,
  reemplazarVariables,
} from './empaquetar-dashboards.mjs';

// Lector mínimo para el ZIP `store` que escribe el empaquetador (sin dependencias).
function leerZip(buffer) {
  const archivos = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const tamano = buffer.readUInt32LE(offset + 18);
    const largoNombre = buffer.readUInt16LE(offset + 26);
    const largoExtra = buffer.readUInt16LE(offset + 28);
    const nombre = buffer.subarray(offset + 30, offset + 30 + largoNombre).toString('utf8');
    const inicio = offset + 30 + largoNombre + largoExtra;
    archivos.set(nombre, buffer.subarray(inicio, inicio + tamano).toString('utf8'));
    offset = inicio + tamano;
  }
  return archivos;
}

test('crearZip produce un ZIP válido y determinista', () => {
  const uno = crearZip([{ nombre: 'b.yaml', contenido: 'b' }, { nombre: 'a.yaml', contenido: 'a' }]);
  const dos = crearZip([{ nombre: 'a.yaml', contenido: 'a' }, { nombre: 'b.yaml', contenido: 'b' }]);
  assert.deepEqual(uno, dos, 'el orden de entrada no cambia el paquete');
  assert.equal(uno.readUInt32LE(0), 0x04034b50, 'empieza con la firma de archivo local');
  assert.equal(uno.readUInt32LE(uno.length - 22), 0x06054b50, 'termina con el fin del directorio central');
  assert.deepEqual([...leerZip(uno).keys()], ['a.yaml', 'b.yaml']);
});

test('reemplazarVariables sustituye el placeholder y falla nombrando la variable que falta', () => {
  assert.equal(
    reemplazarVariables('host: ${SUPERSET_ANALITICA_DB_HOST}', { SUPERSET_ANALITICA_DB_HOST: 'base' }),
    'host: base',
  );
  assert.throws(
    () => reemplazarVariables('host: ${SUPERSET_ANALITICA_DB_HOST}', {}),
    /SUPERSET_ANALITICA_DB_HOST/,
  );
});

test('empaqueta el directorio real: sustituye el host y deja afuera reportes.json', async () => {
  const paquete = await empaquetarDashboards({
    directorio: 'infra/superset/dashboards/rentabilidad',
    variables: { SUPERSET_ANALITICA_DB_HOST: 'base-de-la-app' },
  });
  const archivos = leerZip(paquete);
  const raiz = 'dashboard_export_rentabilidad';
  assert.ok(
    [...archivos.keys()].every((nombre) => nombre.startsWith(`${raiz}/`)),
    'todo el contenido va bajo una carpeta raíz (Superset descarta el primer componente)',
  );
  assert.ok(archivos.has(`${raiz}/metadata.yaml`));
  assert.ok(archivos.has(`${raiz}/databases/Rentabilidad_analitica.yaml`));
  assert.ok(archivos.has(`${raiz}/datasets/Rentabilidad_analitica/margen_producto_canal.yaml`));
  assert.ok(!archivos.has(`${raiz}/reportes.json`), 'reportes.json no viaja a Superset');
  assert.match(archivos.get(`${raiz}/databases/Rentabilidad_analitica.yaml`), /base-de-la-app/);
  assert.doesNotMatch(archivos.get(`${raiz}/databases/Rentabilidad_analitica.yaml`), /\$\{/);
  assert.doesNotMatch(paquete.toString('utf8'), /mercado libre/i);
});

test('empaqueta el tablero de Service técnico (F-SVC-23, FR-063): importable como el de Rentabilidad', async () => {
  const paquete = await empaquetarDashboards({
    directorio: 'infra/superset/dashboards/service',
    variables: { SUPERSET_ANALITICA_DB_HOST: 'base-de-la-app' },
  });
  const archivos = leerZip(paquete);
  const raiz = 'dashboard_export_service';
  assert.ok(
    [...archivos.keys()].every((nombre) => nombre.startsWith(`${raiz}/`)),
    'todo el contenido va bajo una carpeta raíz',
  );
  assert.ok(archivos.has(`${raiz}/metadata.yaml`));
  assert.ok(archivos.has(`${raiz}/databases/Rentabilidad_analitica.yaml`), 'comparte la conexión analítica de Rentabilidad');
  assert.ok(archivos.has(`${raiz}/datasets/Service_analitica/service_reparaciones.yaml`));
  assert.ok(archivos.has(`${raiz}/datasets/Service_analitica/service_reparacion_items.yaml`));
  assert.ok(archivos.has(`${raiz}/dashboards/Service_tecnico_1.yaml`));
  assert.equal(
    [...archivos.keys()].filter((nombre) => nombre.startsWith(`${raiz}/charts/`)).length,
    4,
    'los cuatro indicadores del tablero',
  );
  assert.ok(!archivos.has(`${raiz}/reportes.json`), 'reportes.json no viaja a Superset');
  assert.doesNotMatch(paquete.toString('utf8'), /\$\{/, 'ninguna variable sin sustituir');
  assert.doesNotMatch(paquete.toString('utf8'), /costo_|ganancia/i, 'el tablero no expone costos internos ni ganancia');
});

test('conexionesDelDirectorio lista las bases para el mapa de contraseñas', async () => {
  const archivos = await conexionesDelDirectorio('infra/superset/dashboards/rentabilidad');
  assert.deepEqual(archivos, ['databases/Rentabilidad_analitica.yaml']);
});

test('rechaza una credencial real en un YAML versionado', async () => {
  const directorio = await mkdtemp(path.join(tmpdir(), 'dashboards-'));
  await mkdir(path.join(directorio, 'databases'));
  await writeFile(
    path.join(directorio, 'databases', 'db.yaml'),
    'sqlalchemy_uri: postgresql+psycopg2://usuario:clave-real@host:5432/postgres\n',
  );
  await assert.rejects(
    () => empaquetarDashboards({ directorio, variables: {} }),
    /credencial real/,
  );
});

test('falla con el directorio inexistente', async () => {
  await assert.rejects(
    () => empaquetarDashboards({ directorio: 'infra/superset/no-existe', variables: {} }),
    /No existe el directorio/,
  );
});
