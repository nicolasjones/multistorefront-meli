import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENEDOR_DEV,
  ErrorEntorno,
  SQL_MARCADOR_DEV,
  comandoPara,
  ejecutarProceso,
  entornoLimpio,
  esHostDev,
  leerArgumentos,
  motivoUrlAmbigua,
  principal,
  redactar,
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
    /no es una URL postgres/,
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

// Ejecutor falso: responde por el contenido del SQL (marcador de dev o acción) y registra cada llamada.
function ejecutorFalso({ contenedor = true, respuesta = 't\n', marcador = 'true\n', codigo = 0, error = '' } = {}) {
  const llamadas = [];
  const ejecutar = async (comando, args, opciones = {}) => {
    llamadas.push({ comando, args, ...opciones });
    if (comando === 'docker' && args[0] === 'inspect') return { codigo: contenedor ? 0 : 1, salida: '', error: '' };
    if (opciones.input === SQL_MARCADOR_DEV) return { codigo, salida: marcador, error };
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

test('un error de la base se informa sin filtrar la URL ni la contraseña (usa el entorno inyectado)', async () => {
  const env = { SUPABASE_DB_URL: URL_DEV };
  const { ejecutar } = ejecutorFalso({ codigo: 2, error: `connection to ${URL_DEV} failed: password authentication failed for secreta` });
  await assert.rejects(
    () => principal(['estado', '--entorno', 'dev'], env, { ejecutar, out: () => {} }),
    (e) => /No pude hablar con la base de dev/.test(e.message) && !e.message.includes('secreta') && !e.message.includes(URL_DEV) && e.message.includes('[REDACTADO]'),
  );
});

test('redactar enmascara con el entorno recibido, no con process.env', () => {
  assert.equal(redactar('falló con secreta', { SUPABASE_DB_URL: URL_DEV }), 'falló con [REDACTADO]');
  assert.equal(redactar(`url ${URL_DEV}`, { SUPABASE_DB_URL: URL_DEV }), 'url [REDACTADO]');
  assert.equal(redactar('hola', {}), 'hola');
});

test('los argumentos se leen en cualquier orden y se rechazan los desconocidos', () => {
  assert.deepEqual(leerArgumentos(['--entorno', 'dev', 'encender']), { accion: 'encender', entorno: 'dev' });
  assert.deepEqual(leerArgumentos(['encender', '--entorno', 'dev']), { accion: 'encender', entorno: 'dev' });
  assert.deepEqual(leerArgumentos(['estado', '--entorno=dev']), { accion: 'estado', entorno: 'dev' });
  assert.deepEqual(leerArgumentos(['encender']), { accion: 'encender', entorno: undefined });
  assert.throws(() => leerArgumentos(['encender', '--force']), /no existe/);
  assert.throws(() => leerArgumentos(['encender', 'apagar']), /Sobra el argumento/);
});

test('--entorno dev antes de la acción también funciona', async () => {
  const { ejecutar } = ejecutorFalso({ respuesta: 't\n' });
  assert.equal(await principal(['--entorno', 'dev', 'encender'], {}, { ejecutar, out: () => {} }), true);
});

test('variantes de bypass de la URL: varios hosts, query que pisa el host, porcentajes y arrobas', () => {
  const malas = [
    'postgres://postgres:x@supabase-dev.a.com,prod.interno:5432/postgres',
    'postgres://postgres:x@supabase-dev.a.com:5432,prod.interno:5432/postgres',
    'postgres://postgres:x@supabase-dev.a.com/postgres?host=prod.interno',
    'postgres://postgres:x@supabase-dev.a.com/postgres?sslmode=require&hostaddr=10.0.0.5',
    'postgres://postgres:x@supabase-dev.a.com/postgres?service=prod',
    'postgres://postgres:x@supabase-dev.a.com/postgres?servicefile=/tmp/x',
    'postgres://postgres:x@supabase-dev.a.com/postgres?%68ost=prod.interno',
    'postgres://postgres:x@supabase-dev.a.com?host=prod.interno',
    'postgres://postgres:x@supabase%2Ddev.prod.com/postgres',
    'postgres://postgres:x@supabase-dev.a.com@prod.interno/postgres',
    'postgres://postgres:x@supabase-dev.a.com%2cprod.interno/postgres',
  ];
  for (const url of malas) {
    assert.ok(motivoUrlAmbigua(url), `debería ser ambigua: ${url}`);
    assert.throws(
      () => resolverDestino({ entorno: 'dev', env: { SUPABASE_DB_URL: url, TIENDA_PEDIDOS_DEV_DB_HOSTS: 'supabase-dev.a.com' } }),
      (e) => e instanceof ErrorEntorno && /ambigua/.test(e.message),
      url,
    );
  }
  assert.equal(motivoUrlAmbigua('postgres://postgres:x@supabase-dev.a.com:5432/postgres?sslmode=require'), null);
  assert.equal(motivoUrlAmbigua(URL_DEV), null);
});

test('las variables de libpq que cambian el destino no llegan al proceso hijo', async () => {
  const limpio = entornoLimpio({ PGHOST: 'prod', PGHOSTADDR: '10.0.0.1', PGSERVICE: 's', PGSERVICEFILE: '/f', PGPASSFILE: '/p', PATH: '/bin', OTRA: '1' }, { PGPASSWORD: 'x', PGHOST: 'tambien-prod' });
  for (const k of ['PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE']) assert.equal(k in limpio, false, k);
  assert.equal(limpio.PGPASSWORD, 'x');
  assert.equal(limpio.OTRA, '1');

  // Comprobación real con un proceso hijo: ve PGPASSWORD pero no PGHOST.
  const anterior = { host: process.env.PGHOST, svc: process.env.PGSERVICE };
  process.env.PGHOST = 'prod.interno';
  process.env.PGSERVICE = 'prod';
  try {
    const r = await ejecutarProceso(process.execPath, ['-e', 'console.log(JSON.stringify([process.env.PGHOST ?? null, process.env.PGSERVICE ?? null, process.env.PGPASSWORD ?? null]))'], { env: { PGPASSWORD: 'p' } });
    assert.deepEqual(JSON.parse(r.salida), [null, null, 'p']);
  } finally {
    if (anterior.host === undefined) delete process.env.PGHOST; else process.env.PGHOST = anterior.host;
    if (anterior.svc === undefined) delete process.env.PGSERVICE; else process.env.PGSERVICE = anterior.svc;
  }
});

test('con URL, comprueba por positivo que la base es dev antes de tocar nada', async () => {
  const ok = ejecutorFalso({ respuesta: 't\n', marcador: 'true\n' });
  assert.equal(await principal(['encender', '--entorno', 'dev'], { SUPABASE_DB_URL: URL_DEV }, { ejecutar: ok.ejecutar, out: () => {} }), true);
  assert.equal(ok.llamadas[0].input, SQL_MARCADOR_DEV, 'la primera consulta es el marcador de solo lectura');
  assert.match(ok.llamadas[1].input, /set activa = true/);

  // Un host que «parece» dev pero cuya base no se identifica como dev: se niega y no escribe.
  const falso = ejecutorFalso({ respuesta: 't\n', marcador: 'false\n' });
  await assert.rejects(
    () => principal(['encender', '--entorno', 'dev'], { SUPABASE_DB_URL: URL_DEV }, { ejecutar: falso.ejecutar, out: () => {} }),
    /no se identifica como dev/,
  );
  assert.equal(falso.llamadas.filter((l) => /update/.test(l.input ?? '')).length, 0);

  // El marcador es de solo lectura.
  assert.doesNotMatch(SQL_MARCADOR_DEV, /update|insert|delete|alter|drop/i);
});

test('una acción desconocida o ausente muestra el uso', async () => {
  await assert.rejects(() => principal(['borrar', '--entorno', 'dev'], {}, { out: () => {} }), /Falta la acción/);
  await assert.rejects(() => principal(['--entorno', 'dev'], {}, { out: () => {} }), /Uso: node scripts\/tienda-pedidos-dev\.mjs/);
});
