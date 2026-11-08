// Sondeo de tiendas (épica MSF-206, revisión independiente: SSRF residual). El script `sondeo.mjs` vive embebido en
// el flow monitoreo-salud-tiendas.yml; este test lo extrae del mismo archivo y prueba (1) la estructura del flow y
// (2) la clasificación de IP y el pinning contra DNS rebinding, con un resolver y un cliente HTTP simulados.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const FLOW = 'infra/kestra/flows/monitoreo-salud-tiendas.yml';
const bruto = await readFile(FLOW, 'utf8');
const sinComentarios = bruto.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

function extraerScript(texto) {
  const lineas = texto.split('\n');
  const inicio = lineas.findIndex((l) => /^\s+sondeo\.mjs: \|\s*$/.test(l));
  assert.ok(inicio >= 0, 'el flow debe embeber sondeo.mjs');
  const sangria = lineas[inicio + 1].match(/^\s*/)[0].length;
  const cuerpo = [];
  for (const l of lineas.slice(inicio + 1)) {
    if (l.trim() !== '' && l.match(/^\s*/)[0].length < sangria) break;
    cuerpo.push(l.slice(sangria));
  }
  return cuerpo.join('\n');
}

const script = extraerScript(bruto);
const dir = await mkdtemp(path.join(tmpdir(), 'sondeo-'));
const archivo = path.join(dir, 'sondeo.mjs');
await writeFile(archivo, script);
const { clasificarIp, sondearDominio, sondearTodas } = await import(pathToFileURL(archivo).href);

test('estructura: sondea con un script en Docker, registra por la función y no sigue redirecciones', () => {
  assert.match(sinComentarios, /type: io\.kestra\.plugin\.scripts\.shell\.Commands/);
  assert.match(sinComentarios, /type: io\.kestra\.plugin\.scripts\.runner\.docker\.Docker/);
  assert.match(sinComentarios, /containerImage: node:22-alpine/);
  assert.match(sinComentarios, /public\.tiendas_a_sondear\(\)/);
  assert.match(sinComentarios, /public\.registrar_evento_monitoreo\('tienda', r\.dominio, r\.resultado, r\.motivo, r\.organizacion_id\)/);
  assert.match(sinComentarios, /cron: "\*\/2 \* \* \* \*"/);
  assert.match(sinComentarios, /username: kestra_orquestacion/);
  assert.doesNotMatch(sinComentarios, /password: "(?!\{\{)/);
  assert.doesNotMatch(sinComentarios, /eyJ[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(sinComentarios, /type: io\.kestra\.plugin\.core\.http\.Request/, 'el GET lo hace el script con la IP fijada');
});

test('el script embebido no usa secuencias que Kestra interprete como plantilla', () => {
  assert.doesNotMatch(script, /\{\{|\{%|\{#/);
});

test('el script fija la IP validada (lookup) y no sigue redirecciones', () => {
  assert.match(script, /lookup: \(_host, opciones, devolver\)/);
  assert.match(script, /servername: dominio/);
  assert.doesNotMatch(script, /followRedirects|maxRedirects|location/i);
});

test('IPv4: bloquea loopback, privadas, link-local/metadatos, CGNAT, multicast, 0.0.0.0 y reservadas', () => {
  for (const ip of ['127.0.0.1', '127.255.255.254', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.255',
    '255.255.255.255', '240.0.0.1', '198.18.0.1', '192.0.0.8']) {
    assert.equal(clasificarIp(ip).publica, false, `${ip} debe bloquearse`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '203.0.114.1', '93.184.216.34']) {
    assert.equal(clasificarIp(ip).publica, true, `${ip} es pública`);
  }
});

test('IPv6: bloquea loopback, link-local, ULA, multicast, mapeadas a IPv4 privada y NAT64 hacia metadatos', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd00:ec2::254', 'fdff::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2001:db8::1', '2002:7f00:1::1', '::127.0.0.1', 'not-an-ip']) {
    assert.equal(clasificarIp(ip).publica, false, `${ip} debe bloquearse`);
  }
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2a00:1450:4001::1']) {
    assert.equal(clasificarIp(ip).publica, true, `${ip} es pública`);
  }
});

const resolverCon = (mapa) => async (dominio) => {
  if (!(dominio in mapa)) throw new Error('ENOTFOUND');
  return mapa[dominio];
};

test('un dominio público que resuelve a una IP privada o de metadatos NO se pide y queda no_sondeable', async () => {
  let pedidos = 0;
  const solicitar = async () => { pedidos += 1; return 200; };
  for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', 'fe80::1', 'fd00::5']) {
    const r = await sondearDominio('tienda.example.com', {
      resolver: resolverCon({ 'tienda.example.com': [{ address, family: address.includes(':') ? 6 : 4 }] }), solicitar });
    assert.equal(r.resultado, 'no_sondeable');
    assert.match(r.motivo, /^NO_SONDEABLE_/);
  }
  assert.equal(pedidos, 0);
});

test('si CUALQUIER IP resuelta (A o AAAA) es privada, no se pide aunque otra sea pública', async () => {
  let pedidos = 0;
  const r = await sondearDominio('mixta.example.com', {
    resolver: resolverCon({ 'mixta.example.com': [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }] }),
    solicitar: async () => { pedidos += 1; return 200; },
  });
  assert.equal(r.resultado, 'no_sondeable');
  assert.equal(pedidos, 0);
});

test('si todas son públicas se pide FIJANDO la IP ya resuelta (sin segunda resolución)', async () => {
  const llamadas = [];
  let resoluciones = 0;
  const r = await sondearDominio('ok.example.com', {
    resolver: async () => { resoluciones += 1; return [{ address: '93.184.216.34', family: 4 }]; },
    solicitar: async (dominio, ip, familia) => { llamadas.push([dominio, ip, familia]); return 204; },
  });
  assert.deepEqual(llamadas, [['ok.example.com', '93.184.216.34', 4]]);
  assert.equal(resoluciones, 1);
  assert.deepEqual(r, { resultado: 'ok', motivo: 'HTTP 204' });
});

test('HTTP 5xx, error de red y DNS que no resuelve son fallo de la tienda; un 3xx cuenta como responde', async () => {
  const publico = { 'a.example.com': [{ address: '93.184.216.34', family: 4 }] };
  const con = (solicitar) => sondearDominio('a.example.com', { resolver: resolverCon(publico), solicitar });
  assert.deepEqual(await con(async () => 503), { resultado: 'fallo', motivo: 'HTTP 503' });
  assert.deepEqual(await con(async () => 301), { resultado: 'ok', motivo: 'HTTP 301' });
  assert.deepEqual(await con(async () => { throw new Error('ECONNRESET'); }), { resultado: 'fallo', motivo: 'SIN_RESPUESTA' });
  assert.deepEqual(await sondearDominio('no.example.com', { resolver: resolverCon({}), solicitar: async () => 200 }),
    { resultado: 'fallo', motivo: 'SIN_RESPUESTA' });
});

test('sondearTodas conserva el orden, la organización y limita la concurrencia', async () => {
  const tiendas = Array.from({ length: 12 }, (_, i) => ({ dominio: `t${i}.example.com`, organizacion_id: `org-${i}` }));
  let activas = 0;
  let maxima = 0;
  const resultados = await sondearTodas(tiendas, {
    concurrencia: 5,
    resolver: async (d) => [{ address: d === 't3.example.com' ? '10.0.0.1' : '93.184.216.34', family: 4 }],
    solicitar: async () => {
      activas += 1; maxima = Math.max(maxima, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas -= 1;
      return 200;
    },
  });
  assert.equal(resultados.length, 12);
  assert.deepEqual(resultados.map((r) => r.dominio), tiendas.map((t) => t.dominio));
  assert.equal(resultados[3].resultado, 'no_sondeable');
  assert.equal(resultados[0].organizacion_id, 'org-0');
  assert.ok(maxima <= 5);
});
