import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENEDOR_DEV,
  ErrorEntorno,
  comandoPara,
  esHostDev,
  principal,
  resolverDestino,
  sqlPara,
} from './tienda-pedidos-dev.mjs';

const URL_DEV = 'postgres://postgres:secreta@supabase-dev.212-90-120-53.sslip.io:5432/postgres';

test('esHostDev: solo hosts con etiqueta dev y sin etiquetas de otro entorno ni de la nube', () => {
  assert.equal(esHostDev('supabase-dev.212-90-120-53.sslip.io'), true);
  assert.equal(esHostDev('db.dev.ejemplo.com'), true);
  assert.equal(esHostDev('supabase-stg.212-90-120-53.sslip.io'), false);
  assert.equal(esHostDev('supabase-prd.212-90-120-53.sslip.io'), false);
  assert.equal(esHostDev('dev-prod.ejemplo.com'), false);
  assert.equal(esHostDev('db.abcdefgh.supabase.co'), false);
  assert.equal(esHostDev('dev.pooler.supabase.com'), false);
  assert.equal(esHostDev('localhost'), false);
  assert.equal(esHostDev(''), false);
  assert.equal(esHostDev(undefined), false);
});

test('rechaza sin --entorno dev explícito, con mensaje en castellano', () => {
  for (const entorno of [undefined, 'staging', 'production', 'prd', 'DEV', '']) {
    assert.throws(
      () => resolverDestino({ entorno, env: { SUPABASE_DB_URL: URL_DEV }, contenedorDevExiste: true }),
      (e) => e instanceof ErrorEntorno && /Me niego a operar/.test(e.message) && /--entorno dev/.test(e.message),
      `entorno ${entorno}`,
    );
  }
});

test('rechaza un destino que no es dev aunque se pase --entorno dev', () => {
  for (const url of [
    'postgres://postgres:x@supabase-stg.212-90-120-53.sslip.io:5432/postgres',
    'postgres://postgres:x@supabase-prd.212-90-120-53.sslip.io:5432/postgres',
    'postgres://postgres:x@db.abcdefgh.supabase.co:5432/postgres',
    'postgres://postgres:x@localhost:5432/postgres',
  ]) {
    assert.throws(
      () => resolverDestino({ entorno: 'dev', env: { SUPABASE_DB_URL: url }, contenedorDevExiste: true }),
      (e) => e instanceof ErrorEntorno && /no parece el entorno dev/.test(e.message),
      url,
    );
  }
});

test('rechaza una SUPABASE_DB_URL que no se puede leer', () => {
  assert.throws(
    () => resolverDestino({ entorno: 'dev', env: { SUPABASE_DB_URL: 'esto no es una url' } }),
    /no es una URL de conexión válida/,
  );
});

test('un host declarado a propósito en TIENDA_PEDIDOS_DEV_DB_HOSTS se acepta (túnel a dev)', () => {
  const destino = resolverDestino({
    entorno: 'dev',
    env: { SUPABASE_DB_URL: 'postgres://postgres:x@localhost:54322/postgres', TIENDA_PEDIDOS_DEV_DB_HOSTS: 'otro, localhost' },
  });
  assert.equal(destino.modo, 'url');
  assert.equal(destino.host, 'localhost');
});

test('acepta la URL de dev y, sin URL, el contenedor de dev; sin ninguno se niega', () => {
  assert.deepEqual(resolverDestino({ entorno: 'dev', env: { SUPABASE_DB_URL: URL_DEV } }).modo, 'url');
  assert.deepEqual(resolverDestino({ entorno: 'dev', env: {}, contenedorDevExiste: true }), { modo: 'contenedor', contenedor: CONTENEDOR_DEV });
  assert.throws(
    () => resolverDestino({ entorno: 'dev', env: {}, contenedorDevExiste: false }),
    (e) => e instanceof ErrorEntorno && /no detecto el entorno dev/.test(e.message),
  );
});

test('arma el update correcto para cada acción y nunca interpola datos', () => {
  assert.equal(sqlPara('encender'), "update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos' returning activa;\n");
  assert.equal(sqlPara('apagar'), "update public.banderas_plataforma set activa = false where clave = 'tienda_pedidos' returning activa;\n");
  assert.equal(sqlPara('estado'), "select activa from public.banderas_plataforma where clave = 'tienda_pedidos';\n");
  assert.throws(() => sqlPara("encender'; drop table x; --"), ErrorEntorno);
});

test('la contraseña de la URL viaja por PGPASSWORD y no por argv', () => {
  const { comando, args, env } = comandoPara({ modo: 'url', url: URL_DEV, host: 'supabase-dev.212-90-120-53.sslip.io' });
  assert.equal(comando, 'psql');
  assert.ok(!args.join(' ').includes('secreta'));
  assert.equal(env.PGPASSWORD, 'secreta');
  const docker = comandoPara({ modo: 'contenedor', contenedor: CONTENEDOR_DEV });
  assert.equal(docker.comando, 'docker');
  assert.deepEqual(docker.args.slice(0, 3), ['exec', '-i', CONTENEDOR_DEV]);
});

function ejecutorFalso({ contenedor = true, respuesta = 't\n', codigo = 0, error = '' } = {}) {
  const llamadas = [];
  const ejecutar = async (comando, args, opciones = {}) => {
    llamadas.push({ comando, args, ...opciones });
    if (comando === 'docker' && args[0] === 'inspect') return { codigo: contenedor ? 0 : 1, salida: '', error: '' };
    return { codigo, salida: respuesta, error };
  };
  return { ejecutar, llamadas };
}

test('encender en dev (contenedor) envía el update por stdin y avisa en castellano', async () => {
  const { ejecutar, llamadas } = ejecutorFalso({ respuesta: 't\n' });
  const mensajes = [];
  const encendida = await principal(['encender', '--entorno', 'dev'], {}, { ejecutar, out: (m) => mensajes.push(m) });
  assert.equal(encendida, true);
  const sql = llamadas.find((l) => l.args?.includes('psql'));
  assert.match(sql.input, /set activa = true where clave = 'tienda_pedidos'/);
  assert.ok(!sql.args.join(' ').includes('tienda_pedidos'), 'el SQL no viaja por argv');
  assert.match(mensajes[0], /ENCENDIDA/);
});

test('apagar y estado informan el valor real', async () => {
  const apagar = ejecutorFalso({ respuesta: 'f\n' });
  assert.equal(await principal(['apagar', '--entorno', 'dev'], {}, { ejecutar: apagar.ejecutar, out: () => {} }), false);
  const estado = ejecutorFalso({ respuesta: 't\n' });
  const mensajes = [];
  assert.equal(await principal(['estado', '--entorno', 'dev'], {}, { ejecutar: estado.ejecutar, out: (m) => mensajes.push(m) }), true);
  assert.match(sqlDe(estado.llamadas), /^select activa/);
  assert.doesNotMatch(mensajes[0], /cambio aplicado/);
});

function sqlDe(llamadas) {
  return llamadas.find((l) => l.input)?.input ?? '';
}

test('sin --entorno dev no ejecuta nada', async () => {
  const { ejecutar, llamadas } = ejecutorFalso();
  await assert.rejects(() => principal(['encender'], {}, { ejecutar, out: () => {} }), /Me niego a operar/);
  await assert.rejects(() => principal(['encender', '--entorno', 'staging'], { SUPABASE_DB_URL: URL_DEV }, { ejecutar, out: () => {} }), /Me niego a operar/);
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

test('sin contenedor ni URL se niega y no ejecuta el SQL', async () => {
  const { ejecutar, llamadas } = ejecutorFalso({ contenedor: false });
  await assert.rejects(() => principal(['estado', '--entorno', 'dev'], {}, { ejecutar, out: () => {} }), /no detecto el entorno dev/);
  assert.equal(llamadas.filter((l) => l.input).length, 0);
});

test('si la bandera no existe (migración sin aplicar) no inventa nada', async () => {
  const { ejecutar } = ejecutorFalso({ respuesta: '' });
  await assert.rejects(() => principal(['encender', '--entorno', 'dev'], {}, { ejecutar, out: () => {} }), /no existe en la base de dev/);
});

test('un error de la base se informa sin filtrar la contraseña', async () => {
  const { ejecutar } = ejecutorFalso({ codigo: 2, error: 'connection to server failed' });
  await assert.rejects(
    () => principal(['estado', '--entorno', 'dev'], { SUPABASE_DB_URL: URL_DEV }, { ejecutar, out: () => {} }),
    (e) => /No pude hablar con la base de dev/.test(e.message) && !e.message.includes('secreta'),
  );
});

test('una acción desconocida o ausente muestra el uso', async () => {
  await assert.rejects(() => principal(['borrar', '--entorno', 'dev'], {}, { out: () => {} }), /Falta la acción/);
  await assert.rejects(() => principal(['--entorno', 'dev'], {}, { out: () => {} }), /Uso: node scripts\/tienda-pedidos-dev\.mjs/);
});
