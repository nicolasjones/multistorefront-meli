// Pruebas de la detección de secretos por defecto, del verificador y del generador (MSF-649, MSF-705).
// Los mutantes están en tablas: cada fila debe fallar (o pasar) por UNA sola razón.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { JWT_SECRET_PUBLICO, SECRETOS_JWT_PUBLICOS, contrasenaDeUrl, esNombreSensible, hallazgosPorDefecto, inspeccionarJwt, leerPares, motivoPorDefecto } from './secretos-por-defecto.mjs';
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
    ['ANON_KEY', jwtCon(JWT_SECRET_PUBLICO), /firmado con un secreto público/],
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
  assert.deepEqual(leerPares('  POSTGRES_PASSWORD: postgres\n  - PGPASSWORD=postgres\nDB_URL: postgres://u:p@h/x?a=b\nRUTA=/a:b c'), [['POSTGRES_PASSWORD', 'postgres'], ['PGPASSWORD', 'postgres'], ['DB_URL', 'postgres://u:p@h/x?a=b'], ['RUTA', '/a:b c']]);
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

// ---- Revisión C+S (M4): falsos negativos del detector, cubiertos con casos malos Y buenos ----

const jwtAlg = (alg, secreto, payload = { role: 'anon', iss: 'supabase' }) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg, typ: 'JWT' })}.${b(payload)}`;
  const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg];
  return `${cuerpo}.${createHmac(hash, secreto).update(cuerpo).digest('base64url')}`;
};
const SELF_HOSTED_JWT = 'your-super-secret-jwt-token-with-at-least-32-characters-long';

test('M4: cada falso negativo verificado por la revisión ahora se detecta', () => {
  const malos = [
    'PGPASSWORD=postgres',
    `JWT_SECRET=${JWT_SECRET_PUBLICO} # el de Supabase`,
    'POSTGRES_PASSWORD="postgres" # contraseña local',
    "POSTGRES_PASSWORD='postgres'   # con espacios",
    `JWT_SECRET=${SELF_HOSTED_JWT}`,
    'POSTGRES_PASSWORD=your-super-secret-and-long-postgres-password',
    'DASHBOARD_PASSWORD=this_password_is_insecure_and_should_be_updated',
    'VAULT_ENC_KEY=your-encryption-key-32-chars-min',
    `ANON_KEY=${jwtAlg('HS384', JWT_SECRET_PUBLICO)}`,
    `ANON_KEY=${jwtAlg('HS512', JWT_SECRET_PUBLICO)}`,
    `ANON_KEY=${jwtAlg('HS256', SELF_HOSTED_JWT)}`,
    `SERVICE_ROLE_KEY=${jwtAlg('HS512', SELF_HOSTED_JWT)}`,
    'export PGPASSWORD=postgres',
    'DB_APIKEY=change-me-local',
    'SMTP_PASSWD=password',
  ];
  for (const linea of malos) assert.equal(hallazgosPorDefecto(linea).length, 1, linea.slice(0, 60));
});

test('M4: los casos buenos cercanos NO se marcan (el comentario no cuenta, valores propios con cualquier algoritmo)', () => {
  const buenos = [
    'POSTGRES_PASSWORD=Xk29vLq0aa81 # antes era postgres',
    'POSTGRES_PASSWORD="Xk29vLq0aa81" # postgres',
    'A_PASSWORD="ab #postgres"',
    'PGPASSWORD=Zx81kLm02Qq',
    `ANON_KEY=${jwtAlg('HS384', 'un-secreto-propio-largo-y-aleatorio-9988')}`,
    `ANON_KEY=${jwtAlg('HS512', 'un-secreto-propio-largo-y-aleatorio-9988')}`,
    'KEYBOARD_LAYOUT=postgres', 'TOKENIZER_MODE=postgres', 'WEB_PORT=4300', 'RUNNER_NAME=your-runner',
    'JWT_EXP=3600',
  ];
  for (const linea of buenos) assert.deepEqual(hallazgosPorDefecto(linea), [], linea);
});

test('M4: tabla de nombres sensibles (frontera entre sufijo/segmento y subcadena)', () => {
  const casos = [['PGPASSWORD', true], ['DB_PASSWD', true], ['APIKEY', true], ['MYAPIKEY', true], ['SERVICE_ROLE_KEY', true], ['AUTH_JWT', true],
    ['PASSWORDLESS_MODE', false], ['KEYBOARD', false], ['SECRETARY_NAME', false], ['TOKENIZER', false], ['MONKEY', false], ['', false]];
  for (const [nombre, esperado] of casos) assert.equal(esNombreSensible(nombre), esperado, nombre);
});

test('M4: los dos secretos JWT públicos están en la lista y un JWT HS512 alterado no cae', () => {
  assert.deepEqual(SECRETOS_JWT_PUBLICOS, [JWT_SECRET_PUBLICO, SELF_HOSTED_JWT]);
  const bueno = jwtAlg('HS512', JWT_SECRET_PUBLICO);
  const alterado = `${bueno.slice(0, -2)}${bueno.at(-2) === 'A' ? 'B' : 'A'}${bueno.at(-1)}`;
  assert.equal(inspeccionarJwt(alterado).firmadoConSecretoPublico, false);
  assert.equal(inspeccionarJwt(bueno).firmadoConSecretoPublico, true);
  assert.equal(inspeccionarJwt(jwtAlg('HS256', 'otro-secreto-distinto-de-los-publicos')).firmadoConSecretoPublico, false);
  // alg `none` o desconocido: no se intenta verificar y no lanza
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(inspeccionarJwt(`${b({ alg: 'none' })}.${b({ role: 'x' })}.firma`).firmadoConSecretoPublico, false);
  assert.equal(inspeccionarJwt(`${b({ alg: 'constructor' })}.${b({ role: 'x' })}.firma`).firmadoConSecretoPublico, false);
});

test('QA: la contraseña en la query de una URL y los YAML pasados a --archivo se detectan; los buenos no', () => {
  const malos = [
    'DB_URL=postgresql://h:5432/x?user=u&password=postgres',
    'DB_URL=jdbc:postgresql://h/db?user=u&password=change-me-local',
    'DB_URL=postgres://h/db?sslpassword=postgres',
    'DB_URL=postgres://h/db?PWD=postgres',
    '      POSTGRES_PASSWORD: postgres',
    '  - PGPASSWORD=postgres',
    '      GOTRUE_JWT_SECRET: super-secret-jwt-token-with-at-least-32-characters-long',
    '    DATABASE_URL: "postgres://u:postgres@h/x"',
    '      KESTRA_BASIC_AUTH_PASSWORD: change-me-local # defecto',
  ];
  for (const linea of malos) assert.equal(hallazgosPorDefecto(linea).length, 1, linea);
  const buenos = [
    'DB_URL=postgresql://h:5432/x?user=u&password=Zx81kLm02Qq',
    'DB_URL=postgres://h/db?password=',
    'DB_URL=postgres://h/db?user=postgres&sslmode=require',
    '      POSTGRES_USER: postgres',
    '      POSTGRES_PASSWORD: ${DB_PASSWORD:?falta}',
    '      POSTGRES_PASSWORD: valorPropioLargo9',
    '  - WEB_PORT=4300',
  ];
  for (const linea of buenos) assert.deepEqual(hallazgosPorDefecto(linea), [], linea);
  // contrasenaDeUrl: userinfo gana sobre la query; query sin clave conocida no cuenta
  assert.equal(contrasenaDeUrl('postgres://u:uno@h/x?password=dos'), 'uno');
  assert.equal(contrasenaDeUrl('postgres://h/x?token=abc'), null);
  // El CLI acepta un YAML (docker compose config) por stdin y por archivo.
  const r = spawnSync(process.execPath, [verificador, '--archivo', '-'], { encoding: 'utf8', input: 'services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: postgres\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /POSTGRES_PASSWORD/);
});
