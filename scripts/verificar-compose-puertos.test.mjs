// Pruebas del guard de puertos publicados (MSF-648). Tablas de casos que fallan y que pasan, y mutaciones sobre el repo real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analizarCompose, analizarComandos, analizarRaiz, hallazgoDePuerto, ipAcotada, separarPuerto } from './verificar-compose-puertos.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = (...puertos) => `services:\n  db:\n    image: postgres\n    ports:\n${puertos.map((p) => `      - ${p}`).join('\n')}\n`;

test('ipAcotada: frontera de loopback y Tailscale (n-1 / n / n+1) y variables', () => {
  const casos = [
    ['127.0.0.1', true], ['127.255.255.254', true], ['::1', true], ['[::1]', true], ['localhost', true],
    ['100.64.0.1', true], ['100.127.255.255', true],
    ['100.63.255.255', false], ['100.128.0.0', false], ['126.255.255.255', false], ['128.0.0.1', false],
    ['0.0.0.0', false], ['::', false], ['', false], ['10.0.0.5', false], ['192.168.1.2', false], ['127.0.0', false], ['127.0.0.1.5', false], ['999.0.0.1', false], ['127.0.0.-1', false],
    ['${BIND}', false], ['${BIND:-0.0.0.0}', false], ['${BIND:-127.0.0.1}', true], ['${BIND-127.0.0.1}', true],
  ];
  for (const [ip, esperado] of casos) assert.equal(ipAcotada(ip), esperado, `«${ip}»`);
});

test('separarPuerto: sintaxis corta con variables, IPv6 y protocolo', () => {
  assert.deepEqual(separarPuerto('"127.0.0.1:8085:8080"'), { ip: '127.0.0.1', restante: '8085:8080' });
  assert.deepEqual(separarPuerto('8085:8080'), { ip: null, restante: '8085:8080' });
  assert.deepEqual(separarPuerto('8080'), { ip: null, restante: '8080' });
  assert.deepEqual(separarPuerto('"127.0.0.1:${PUERTO:-8085}:8080/tcp"'), { ip: '127.0.0.1', restante: '${PUERTO:-8085}:8080' });
  assert.deepEqual(separarPuerto('[::1]:81:81'), { ip: '[::1]', restante: '81:81' });
  assert.deepEqual(separarPuerto('"${IP:-127.0.0.1}:80:80"'), { ip: '${IP:-127.0.0.1}', restante: '80:80' });
});

test('hallazgoDePuerto: cada forma de publicar en 0.0.0.0 falla y cada acotada pasa', () => {
  const fallan = ['"7634:5432"', '7634:5432', '"5432"', '0.0.0.0:7634:5432', '":7634:5432"', '"[::]:80:80"', '10.1.2.3:80:80', '"${BIND}:80:80"', '"${BIND:-0.0.0.0}:80:80"', '8085:8080/udp'];
  const pasan = ['"127.0.0.1:7634:5432"', '127.0.0.1:${P:-1}:2', '"[::1]:80:80"', '100.80.1.2:4301:3000', '"${IP:-127.0.0.1}:80:80"'];
  for (const p of fallan) assert.ok(hallazgoDePuerto(p), `debería fallar: ${p}`);
  for (const p of pasan) assert.equal(hallazgoDePuerto(p), null, `debería pasar: ${p}`);
});

test('analizarCompose: servicios sensibles publicados en 0.0.0.0 fallan, con número de línea', () => {
  for (const sensible of ['"7634:5432"', '"4301:3000"', '"9300:8000"', '"4306:9000"', '"3000:3000"']) {
    const h = analizarCompose('c.yaml', compose(sensible));
    assert.equal(h.length, 1, sensible);
    assert.match(h[0], /^c\.yaml:5: /);
  }
  assert.deepEqual(analizarCompose('c.yaml', compose('"127.0.0.1:7634:5432"', '"[::1]:4301:3000"')), []);
  assert.equal(analizarCompose('c.yaml', compose('"127.0.0.1:7634:5432"', '"4301:3000"')).length, 1, 'uno bueno y uno malo: falla por el malo');
});

test('analizarCompose: lista en línea, ports vacío, !reset, comentarios y network_mode', () => {
  assert.equal(analizarCompose('c', 'services:\n  a:\n    ports: ["8080:80", "127.0.0.1:81:81"]\n').length, 1);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    ports: ["127.0.0.1:81:81"]\n'), []);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    ports: !reset []\n'), []);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    ports: []\n'), []);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    # ports:\n    #   - "80:80"\n    image: x\n'), []);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    ports:\n      # - "80:80"\n      - "127.0.0.1:80:80" # solo local\n'), []);
  assert.equal(analizarCompose('c', 'services:\n  a:\n    network_mode: host\n').length, 1);
  assert.equal(analizarCompose('c', 'services:\n  a:\n    network_mode: "host"\n').length, 1);
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    network_mode: bridge\n'), []);
  assert.deepEqual(analizarCompose('c', '# network_mode: host\nservices: {}\n'), []);
});

test('analizarCompose: ports de un servicio no contamina al siguiente', () => {
  const texto = 'services:\n  a:\n    ports:\n      - "127.0.0.1:80:80"\n  b:\n    image: x\n    command: ["a", "8080:80"]\n';
  assert.deepEqual(analizarCompose('c', texto), []);
});

test('analizarCompose: sintaxis larga exige host_ip acotada', () => {
  const largo = (host) => `services:\n  a:\n    ports:\n      - target: 80\n        published: 8080\n${host === undefined ? '' : `        host_ip: ${host}\n`}        protocol: tcp\n  b:\n    image: x\n`;
  assert.equal(analizarCompose('c', largo(undefined)).length, 1);
  assert.equal(analizarCompose('c', largo('0.0.0.0')).length, 1);
  assert.deepEqual(analizarCompose('c', largo('127.0.0.1')), []);
  assert.deepEqual(analizarCompose('c', largo('"127.0.0.1"')), []);
  // `target` sin `published` no publica en el host.
  assert.deepEqual(analizarCompose('c', 'services:\n  a:\n    ports:\n      - target: 80\n'), []);
});

test('analizarComandos: docker run -p sin IP falla, con IP pasa; otras líneas se ignoran', () => {
  const casos = [
    ['docker run --rm -p 8000:8000 img', 1], ['docker run --rm -p 127.0.0.1:8000:8000 img', 0], ['docker run --publish 5432:5432 img', 1],
    ['docker run --publish=5432:5432 img', 1], ['docker run -p "8000:8000" img', 1], ['docker run -p "127.0.0.1:8000:8000" img', 0],
    ['docker run --rm img', 0], ['echo -p 8000:8000', 0], ['docker create -p 80:80 img', 1], ['docker run -v a:b img', 0],
  ];
  for (const [linea, n] of casos) assert.equal(analizarComandos('x', linea).length, n, linea);
});

test('el repositorio real cumple el guard', () => {
  assert.deepEqual(analizarRaiz(raiz), []);
});

test('mutaciones sobre el repo real: quitar el 127.0.0.1 de un puerto o publicar en 0.0.0.0 hace fallar el guard', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'puertos-'));
  await cp(path.join(raiz, 'infra'), path.join(tmp, 'infra'), { recursive: true });
  await cp(path.join(raiz, 'package.json'), path.join(tmp, 'package.json'));
  assert.deepEqual(analizarRaiz(tmp), []);
  const rutas = ['kestra', 'superset', 'nango', 'glitchtip', 'refine', 'playwright', 'mcp-server'].map((p) => path.join(tmp, 'infra', p, 'compose.yaml'));
  for (const ruta of rutas) {
    const original = await readFile(ruta, 'utf8');
    assert.match(original, /"127\.0\.0\.1:/, `${ruta}: el guard no es vacuo, hay un puerto acotado`);
    await writeFile(ruta, original.replace('"127.0.0.1:', '"'));
    assert.equal(analizarRaiz(tmp).length, 1, `quitar la IP en ${path.basename(path.dirname(ruta))}`);
    await writeFile(ruta, original.replace('"127.0.0.1:', '"0.0.0.0:'));
    assert.equal(analizarRaiz(tmp).length, 1, `0.0.0.0 en ${path.basename(path.dirname(ruta))}`);
    await writeFile(ruta, original);
  }
  assert.deepEqual(analizarRaiz(tmp), []);
  const pkg = path.join(tmp, 'package.json');
  const original = await readFile(pkg, 'utf8');
  await writeFile(pkg, original.replace('-p 127.0.0.1:8000:8000', '-p 8000:8000'));
  assert.equal(analizarRaiz(tmp).length, 1);
  const r = spawnSync(process.execPath, [path.join(raiz, 'scripts', 'verificar-compose-puertos.mjs'), tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /package\.json/);
});
