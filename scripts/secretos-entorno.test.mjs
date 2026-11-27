// Pruebas de la detección de secretos por defecto, del verificador y del generador (MSF-649, MSF-705).
// Los mutantes están en tablas: cada fila debe fallar (o pasar) por UNA sola razón.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JWT_SECRET_PUBLICO, contrasenaDeUrl, esNombreSensible, hallazgosPorDefecto, inspeccionarJwt, leerPares, motivoPorDefecto } from './secretos-por-defecto.mjs';
import { aleatorio, firmarJwt, generarSecretos, validarSalida } from './generar-secretos-entorno.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const verificador = path.join(aqui, 'verificar-secretos-por-defecto.mjs');
const generador = path.join(aqui, 'generar-secretos-entorno.mjs');
const jwtCon = (secreto, payload = { role: 'anon', iss: 'supabase' }) => firmarJwt(payload, secreto);

test('esNombreSensible: por segmentos de nombre, sin falsos positivos por subcadena', () => {
  const casos = [
    ['KESTRA_DB_PASSWORD', true], ['SUPERSET_SECRET_KEY', true], ['NANGO_ENCRYPTION_KEY', true], ['SUPABASE_ANON_KEY', true],
    ['GOTRUE_JWT_SECRET', true], ['AVISOS_REPOSICION_APIKEY', true], ['SECRET_WHATSAPP_TOKEN', true],
    ['KESTRA_BASIC_AUTH_USERNAME', false], ['KEYBOARD_LAYOUT', false], ['WEB_PORT', false], ['TOKENIZER_MODE', false],
  ];
  for (const [nombre, esperado] of casos) assert.equal(esNombreSensible(nombre), esperado, nombre);
});

test('motivoPorDefecto: cada valor por defecto conocido se detecta (mutantes que deben fallar)', () => {
  const casos = [
    ['GOTRUE_JWT_SECRET', JWT_SECRET_PUBLICO, /JWT público/],
    ['NANGO_ENCRYPTION_KEY', 'ybH2At/IUEgUmWW9GMI9PIZbrgQXbuZO97zJShOJElg=', /repositorio/],
    ['NANGO_SECRET_KEY_DEV', '01df8743-e924-4364-8e5e-952170af0721', /repositorio/],
    ['POSTGRES_PASSWORD', 'postgres', /contraseña/],
    ['POSTGRES_PASSWORD', 'Postgres', /contraseña/],
    ['KESTRA_BASIC_AUTH_PASSWORD', 'change-me-local', /contraseña/],
    ['KESTRA_BASIC_AUTH_PASSWORD', 'Change-Me-Algo', /contraseña/],
    ['NANGO_DASHBOARD_PASSWORD', 'ChangeMe1Local', /contraseña/],
    ['SUPERSET_DB_PASSWORD', 'superset-local', /contraseña/],
    ['SUPABASE_DB_URL', 'postgres://postgres:postgres@host.docker.internal:7634/postgres', /URL/],
    ['KESTRA_BACKUPS_DB_URL', 'jdbc:postgresql://u:change-me-local@db:5432/x', /URL/],
    ['ANON_KEY', jwtCon(JWT_SECRET_PUBLICO), /firmado con el secreto público/],
    ['ANON_KEY', jwtCon('otro-secreto-distinto', { role: 'anon', iss: 'supabase-demo' }), /demostración/],
  ];
  for (const [nombre, valor, motivo] of casos) assert.match(String(motivoPorDefecto(nombre, valor)), motivo, `${nombre}=${valor.slice(0, 12)}…`);
});

test('motivoPorDefecto: valores propios y variables no sensibles NO se marcan (mutantes que deben pasar)', () => {
  const generados = generarSecretos();
  for (const [nombre, valor] of generados) assert.equal(motivoPorDefecto(nombre, valor), null, `${nombre} generado no puede ser «por defecto»`);
  const casos = [
    ['POSTGRES_PASSWORD', 'q8vN2xJt0Zk4'], ['WEB_PORT', '4300'], ['KESTRA_BASIC_AUTH_USERNAME', 'admin@local.test'],
    ['SUPABASE_URL', 'https://api.ejemplo.com'], ['CORREO_MASIVO_URL_BAJA', 'https://panel.ejemplo.com'],
    ['X_PASSWORD', ''], ['X_PASSWORD', '   '],
    ['OTRO_JWT', jwtCon('un-secreto-propio-largo-y-aleatorio-123456', { role: 'anon', iss: 'supabase' })],
    ['DB_URL', 'postgres://postgres@db:5432/x'], ['DB_URL', 'postgres://app:Zx81kLm02@db:5432/x'],
    ['LOG_LEVEL', 'postgres'], // no sensible por nombre: «postgres» solo es una contraseña si la variable es una contraseña
  ];
  for (const [nombre, valor] of casos) assert.equal(motivoPorDefecto(nombre, valor), null, `${nombre}=${valor}`);
});

test('inspeccionarJwt: solo tres partes válidas; basura no lanza', () => {
  for (const basura of ['', 'a.b', 'a.b.c', '..', 'aaa.bbb.ccc.ddd', 'no-es-jwt']) assert.equal(inspeccionarJwt(basura), null, basura);
  assert.equal(inspeccionarJwt(jwtCon('x'.repeat(40)))?.firmadoConSecretoPublico, false);
  assert.equal(inspeccionarJwt(jwtCon(JWT_SECRET_PUBLICO))?.firmadoConSecretoPublico, true);
  // Firma alterada en un solo carácter: ya no coincide con el secreto público.
  const buena = jwtCon(JWT_SECRET_PUBLICO);
  const alterada = `${buena.slice(0, -2)}${buena.at(-2) === 'A' ? 'B' : 'A'}${buena.at(-1)}`;
  assert.equal(inspeccionarJwt(alterada)?.firmadoConSecretoPublico, false);
});

test('contrasenaDeUrl', () => {
  assert.equal(contrasenaDeUrl('postgres://u:abc%21@h/db'), 'abc!');
  assert.equal(contrasenaDeUrl('jdbc:postgresql://u:p@h:1/db'), 'p');
  for (const sin of ['https://h/x', 'texto', 'postgres://u@h/db', 'http://[::bad']) assert.equal(contrasenaDeUrl(sin), null, sin);
});

test('leerPares: ignora comentarios, export y comillas', () => {
  const pares = leerPares('# A=1\nexport B="dos"\nC=\'tres\'\n  D = cuatro \nsin_igual\n=x\nE F=5');
  assert.deepEqual(pares, [['B', 'dos'], ['C', 'tres'], ['D', 'cuatro']]);
});

test('hallazgosPorDefecto nunca incluye el valor, solo nombre y motivo', () => {
  const secreto = 'change-me-local-valor-que-no-debe-salir';
  const h = hallazgosPorDefecto(`KESTRA_DB_PASSWORD=${secreto}\nWEB_PORT=4300`);
  assert.deepEqual(h.map((x) => x.nombre), ['KESTRA_DB_PASSWORD']);
  assert.ok(!JSON.stringify(h).includes(secreto));
});

test('CLI verificador: 0 con valores propios, 1 con uno por defecto, 2 sin archivo; no imprime valores', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sec-'));
  const limpio = path.join(dir, 'limpio.env');
  const sucio = path.join(dir, 'sucio.env');
  await writeFile(limpio, 'POSTGRES_PASSWORD=Xk29vLq0aa81\nWEB_PORT=4300\n');
  await writeFile(sucio, `POSTGRES_PASSWORD=postgres\nGOTRUE_JWT_SECRET=${JWT_SECRET_PUBLICO}\n`);
  const correr = (...args) => spawnSync(process.execPath, [verificador, ...args], { encoding: 'utf8' });
  assert.equal(correr('--archivo', limpio).status, 0);
  const malo = correr('--archivo', sucio);
  assert.equal(malo.status, 1);
  assert.match(malo.stderr, /POSTGRES_PASSWORD/);
  assert.match(malo.stderr, /GOTRUE_JWT_SECRET/);
  assert.ok(!malo.stderr.includes(JWT_SECRET_PUBLICO) && !malo.stdout.includes(JWT_SECRET_PUBLICO));
  assert.equal(correr().status, 2);
  assert.equal(correr('--archivo', path.join(dir, 'no-existe.env')).status, 2);
  const porStdin = spawnSync(process.execPath, [verificador, '--archivo', '-'], { encoding: 'utf8', input: 'A_SECRET=change-me-x\n' });
  assert.equal(porStdin.status, 1);
});

test('generarSecretos: JWT válidos con el secreto generado, distintos en cada corrida y sin repetirse', () => {
  const a = generarSecretos({ ahora: 1_000_000 });
  const b = generarSecretos({ ahora: 1_000_000 });
  for (const clave of ['JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'POSTGRES_PASSWORD', 'KESTRA_BASIC_AUTH_PASSWORD', 'SUPERSET_SECRET_KEY', 'NANGO_ENCRYPTION_KEY']) {
    assert.notEqual(a.get(clave), b.get(clave), `${clave} no se repite entre corridas`);
  }
  const anon = inspeccionarJwt(a.get('ANON_KEY'));
  assert.equal(anon.payload.role, 'anon');
  assert.equal(anon.payload.iss, 'supabase');
  assert.equal(anon.payload.exp - anon.payload.iat, 10 * 365 * 24 * 3600);
  assert.equal(inspeccionarJwt(a.get('SERVICE_ROLE_KEY')).payload.role, 'service_role');
  // La firma corresponde al secreto generado y NO al público.
  const reconstruido = firmarJwt({ role: 'anon', iss: 'supabase', iat: 1_000_000, exp: 1_000_000 + 10 * 365 * 24 * 3600 }, a.get('JWT_SECRET'));
  assert.equal(reconstruido, a.get('ANON_KEY'));
  assert.equal(inspeccionarJwt(a.get('ANON_KEY')).firmadoConSecretoPublico, false);
  assert.ok(a.get('JWT_SECRET').length >= 32);
  assert.equal(Buffer.from(a.get('NANGO_ENCRYPTION_KEY'), 'base64').length, 32);
  assert.match(a.get('NANGO_SECRET_KEY_DEV'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(aleatorio(8).length >= 8);
});

test('generarSecretos cubre cada credencial obligatoria del despliegue (MSF-705)', async () => {
  const { VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
  const generadas = generarSecretos({ entorno: 'staging' });
  assert.match(generadas.get('KESTRA_BACKUPS_PGDUMP_URL'), new RegExp(`^postgres://postgres:${generadas.get('POSTGRES_PASSWORD')}@host\\.docker\\.internal:7635/postgres$`), 'la URL de pg_dump usa la contraseña y el puerto de ese entorno');
  assert.equal(generarSecretos({ entorno: 'production' }).get('KESTRA_BACKUPS_PGDUMP_URL').endsWith(':7636/postgres'), true);
  for (const { nombre, inmutable } of VARIABLES_OBLIGATORIAS) {
    if (inmutable || nombre === 'CORREO_MASIVO_URL_BAJA' || nombre === 'KESTRA_BASIC_AUTH_USERNAME') continue;
    assert.ok(generadas.has(nombre), `${nombre} no lo genera el script`);
  }
});

test('validarSalida: rechaza rutas dentro del repo, vacías y archivos existentes', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'repo-'));
  const fuera = await mkdtemp(path.join(tmpdir(), 'fuera-'));
  assert.throws(() => validarSalida(undefined, raiz), /Falta --salida/);
  assert.throws(() => validarSalida(path.join(raiz, 'dev.env'), raiz), /dentro del repositorio/);
  assert.throws(() => validarSalida(raiz, raiz), /dentro del repositorio/);
  assert.throws(() => validarSalida(path.join(raiz, 'sub', 'x.env'), raiz), /dentro del repositorio/);
  const existente = path.join(fuera, 'ya.env');
  await writeFile(existente, 'x');
  assert.throws(() => validarSalida(existente, raiz), /no se sobrescribe/);
  assert.equal(validarSalida(path.join(fuera, 'nuevo.env'), raiz), path.join(fuera, 'nuevo.env'));
});

test('CLI generador: archivo 0600 fuera del repo, no imprime valores y no sobrescribe', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gen-'));
  const salida = path.join(dir, 'dev.env');
  const r = spawnSync(process.execPath, [generador, '--entorno', 'dev', '--salida', salida], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const contenido = await readFile(salida, 'utf8');
  assert.equal(((await stat(salida)).mode & 0o777).toString(8), '600');
  for (const [, valor] of leerPares(contenido)) assert.ok(!r.stdout.includes(valor) && !r.stderr.includes(valor), 'no imprime valores');
  assert.match(r.stdout, /JWT_SECRET/);
  assert.deepEqual(hallazgosPorDefecto(contenido), [], 'lo generado pasa el guard de valores por defecto');
  assert.equal(spawnSync(process.execPath, [generador, '--entorno', 'dev', '--salida', salida], { encoding: 'utf8' }).status, 1, 'no sobrescribe');
  assert.equal(spawnSync(process.execPath, [generador, '--entorno', 'otro', '--salida', path.join(dir, 'x.env')], { encoding: 'utf8' }).status, 1);
  // Salida dentro del repositorio real: rechazada.
  const enRepo = spawnSync(process.execPath, [generador, '--entorno', 'dev', '--salida', path.join(aqui, '..', 'secretos-prueba.env')], { encoding: 'utf8' });
  assert.equal(enRepo.status, 1);
});
