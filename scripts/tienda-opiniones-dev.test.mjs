import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAVE_BANDERA,
  CONTENEDOR_DEV,
  ErrorEntorno,
  ORGS_DEMO_SEED,
  PREFIJO_ENV,
  comandoPara,
  leerArgumentos,
  principal,
  resolverDestino,
  sqlMarcadorDev,
  sqlPara,
} from './tienda-opiniones-dev.mjs';

const URL_DEV = 'postgres://postgres:secreta@supabase-dev.212-90-120-53.sslip.io:5432/postgres';

// Ejecutor falso: responde por el contenido del SQL (marcador de dev o acción) y registra cada llamada.
function ejecutorFalso({ contenedor = true, respuesta = 't\n', marcador = 'true\n', codigo = 0, error = '' } = {}) {
  const llamadas = [];
  const ejecutar = async (comando, args, opciones = {}) => {
    llamadas.push({ comando, args, ...opciones });
    if (comando === 'docker' && args[0] === 'inspect') return { codigo: contenedor ? 0 : 1, salida: '', error: '' };
    if (/from public\.organizaciones/.test(opciones.input ?? '')) return { codigo, salida: marcador, error };
    return { codigo, salida: respuesta, error };
  };
  return { ejecutar, llamadas };
}

test('la bandera es la de opiniones y el SQL no interpola datos', () => {
  assert.equal(CLAVE_BANDERA, 'tienda_opiniones');
  assert.equal(sqlPara('encender'), "update public.banderas_plataforma set activa = true where clave = 'tienda_opiniones' returning activa;\n");
  assert.equal(sqlPara('apagar'), "update public.banderas_plataforma set activa = false where clave = 'tienda_opiniones' returning activa;\n");
  assert.equal(sqlPara('estado'), "select activa from public.banderas_plataforma where clave = 'tienda_opiniones';\n");
  assert.throws(() => sqlPara("encender'; drop table x; --"), ErrorEntorno);
});

test('sin --entorno dev no ejecuta nada', async () => {
  const { ejecutar, llamadas } = ejecutorFalso();
  await assert.rejects(
    () => principal(['encender'], {}, { ejecutar, out: () => {} }),
    (e) => e instanceof ErrorEntorno && /Me niego a operar/.test(e.message) && /tienda_opiniones/.test(e.message),
  );
  await assert.rejects(
    () => principal(['encender', '--entorno', 'staging'], { SUPABASE_DB_URL: URL_DEV }, { ejecutar, out: () => {} }),
    /Me niego a operar/,
  );
  assert.equal(llamadas.filter((l) => l.input).length, 0);
});

test('con un destino que no es dev no llega a ejecutar el SQL', async () => {
  const { ejecutar, llamadas } = ejecutorFalso();
  await assert.rejects(
    () => principal(['encender', '--entorno', 'dev'], { SUPABASE_DB_URL: 'postgres://postgres:x@supabase-prd.212-90-120-53.sslip.io/postgres' }, { ejecutar, out: () => {} }),
    /no parece el entorno dev/,
  );
  assert.equal(llamadas.length, 0);
});

test('el host declarado a propósito para opiniones se acepta (túnel a dev)', () => {
  const destino = resolverDestino({
    entorno: 'dev',
    env: { SUPABASE_DB_URL: 'postgres://postgres:x@localhost:54322/postgres', TIENDA_OPINIONES_DEV_DB_HOSTS: 'localhost' },
  });
  assert.equal(destino.modo, 'url');
  assert.equal(destino.host, 'localhost');
});

test('encender en dev envía el update por stdin, comprueba el marcador antes y avisa en castellano', async () => {
  const { ejecutar, llamadas } = ejecutorFalso({ respuesta: 't\n' });
  const mensajes = [];
  const encendida = await principal(['encender', '--entorno', 'dev'], {}, { ejecutar, out: (m) => mensajes.push(m) });
  assert.equal(encendida, true);
  const psql = llamadas.filter((l) => l.args?.includes('psql'));
  assert.match(psql[0].input, /from public\.organizaciones/, 'la primera consulta es el marcador de solo lectura');
  assert.match(psql[1].input, /set activa = true where clave = 'tienda_opiniones'/);
  assert.ok(!psql[1].args.join(' ').includes('tienda_opiniones'), 'el SQL no viaja por argv');
  assert.match(mensajes[0], /Bandera tienda_opiniones en dev: ENCENDIDA/);
});

test('una base que no se identifica como dev no se toca', async () => {
  const { ejecutar, llamadas } = ejecutorFalso({ respuesta: 't\n', marcador: 'false\n' });
  await assert.rejects(
    () => principal(['encender', '--entorno', 'dev'], {}, { ejecutar, out: () => {} }),
    /no se identifica como dev/,
  );
  assert.equal(llamadas.filter((l) => /update/.test(l.input ?? '')).length, 0);
});

test('si la bandera no existe en la base (migración sin aplicar) no inventa nada', async () => {
  const { ejecutar } = ejecutorFalso({ respuesta: '' });
  await assert.rejects(
    () => principal(['encender', '--entorno', 'dev'], {}, { ejecutar, out: () => {} }),
    /no existe en la base de dev/,
  );
});

test('el marcador de dev usa el prefijo de esta bandera y valida los ids extra', () => {
  const sql = sqlMarcadorDev({});
  for (const id of ORGS_DEMO_SEED) assert.ok(sql.includes(`'${id}'`));
  assert.match(sql, /nombre like '%\(demo\)'/);
  assert.doesNotMatch(sql, /update|insert|delete|alter|drop|truncate/i);
  const extra = '11111111-2222-3333-4444-555555555555';
  assert.ok(sqlMarcadorDev({ TIENDA_OPINIONES_DEV_ORG_IDS: extra }).includes(`'${extra}'`));
  assert.throws(() => sqlMarcadorDev({ TIENDA_OPINIONES_DEV_ORG_IDS: "x'); drop table public.organizaciones; --" }), /no es un uuid/);
  assert.equal(PREFIJO_ENV, 'TIENDA_OPINIONES_DEV');
});

test('la contraseña de la URL viaja por PGPASSWORD y no por argv', () => {
  const { comando, args, env } = comandoPara({ modo: 'url', url: URL_DEV, host: 'supabase-dev.212-90-120-53.sslip.io' });
  assert.equal(comando, 'psql');
  assert.ok(!args.join(' ').includes('secreta'));
  assert.equal(env.PGPASSWORD, 'secreta');
  const docker = comandoPara({ modo: 'contenedor', contenedor: CONTENEDOR_DEV });
  assert.deepEqual(docker.args.slice(0, 3), ['exec', '-i', CONTENEDOR_DEV]);
});

test('los argumentos se leen en cualquier orden y una acción desconocida muestra el uso', async () => {
  assert.deepEqual(leerArgumentos(['--entorno', 'dev', 'encender']), { accion: 'encender', entorno: 'dev' });
  assert.deepEqual(leerArgumentos(['estado', '--entorno=dev']), { accion: 'estado', entorno: 'dev' });
  await assert.rejects(() => principal(['borrar', '--entorno', 'dev'], {}, { out: () => {} }), /Falta la acción/);
  await assert.rejects(() => principal(['--entorno', 'dev'], {}, { out: () => {} }), /Uso: node scripts\/tienda-opiniones-dev\.mjs/);
});
