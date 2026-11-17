import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { redesDeFlows, redesFueraDeConvencion, validarPolitica } from './validar-egress-workers.mjs';

const base = () => ({
  version: 1,
  common: { supabase: 'x', vault: 'y', blocked_examples: ['example.com'] },
  workers: {
    sistema: { network: 'worker-egress-sistema', solo_supabase: true, domains: [], workers: ['a'] },
  },
});

test('valida una politica que cubre todos los workers y redes', () => {
  assert.equal(validarPolitica(base(), ['a'], new Set(['sistema'])), 1);
});

test('falla si hay un worker descubierto sin entrada (no pasa en vacio)', () => {
  assert.throws(() => validarPolitica(base(), ['a', 'b']), /sin allowlist.*b/);
  assert.throws(() => validarPolitica({ ...base(), workers: {} }, ['a']), /sin allowlist.*a/);
});

test('falla si un flow referencia una red sin entrada', () => {
  assert.throws(() => validarPolitica(base(), ['a'], new Set(['otra'])), /worker-egress-otra/);
});

test('falla si la politica nombra un worker inexistente', () => {
  const p = base();
  p.workers.sistema.workers = ['a', 'q'];
  assert.throws(() => validarPolitica(p, ['a']), /no existen.*q/);
});

test('exige dominios o solo_supabase, y rechaza destinos denegados', () => {
  const sin = base();
  delete sin.workers.sistema.solo_supabase;
  assert.throws(() => validarPolitica(sin, ['a']), /dominios/);
  const malo = base();
  delete malo.workers.sistema.solo_supabase;
  malo.workers.sistema.domains = ['example.com'];
  assert.throws(() => validarPolitica(malo, ['a']), /denegado/);
});

test('la red debe llamarse worker-egress-<sistema>', () => {
  const p = base();
  p.workers.sistema.network = 'worker-egress-otro';
  assert.throws(() => validarPolitica(p, ['a']), /red de egress/);
});

test('solo_supabase con domains no vacio es incoherente y se rechaza', () => {
  const p = base();
  p.workers.sistema.domains = ['api.proveedor.com'];
  assert.throws(() => validarPolitica(p, ['a']), /incoherente/);
});

test('rechaza comodines de TLD y dominios sin al menos dos etiquetas', () => {
  for (const dominio of ['*.com', '*', 'com', '*.co.uk.']) {
    const p = base();
    delete p.workers.sistema.solo_supabase;
    p.workers.sistema.domains = [dominio];
    assert.throws(() => validarPolitica(p, ['a']), /invalidos/, dominio);
  }
  const ok = base();
  delete ok.workers.sistema.solo_supabase;
  ok.workers.sistema.domains = ['*.proveedor.com', 'api.proveedor.com'];
  assert.equal(validarPolitica(ok, ['a']), 1);
});

test('detecta workers inexistentes aunque no se haya descubierto ninguno', () => {
  assert.throws(() => validarPolitica(base(), []), /no existen.*a/);
});

function flows(archivos, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-'));
  try {
    for (const [nombre, contenido] of Object.entries(archivos)) {
      fs.mkdirSync(path.dirname(path.join(dir, nombre)), { recursive: true });
      fs.writeFileSync(path.join(dir, nombre), contenido);
    }
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('lee la red de los flows con comillas dobles, simples, --network y subdirectorios', () => {
  flows({
    'a.yml': 'WORKER_NETWORK_ESPERADA="worker-egress-uno"',
    'b.yml': "WORKER_NETWORK_ESPERADA='worker-egress-dos'",
    'c.yaml': 'docker run --network=worker-egress-tres x',
    'sub/d.yml': 'docker run --network worker-egress-cuatro x',
    'sub/hondo/e.yml': 'docker run --network "worker-egress-cinco" x',
    'f.yml': 'WORKER_NETWORK_ESPERADA="worker-egress-$SISTEMA_EXTERNO"',
  }, (dir) => {
    assert.deepEqual([...redesDeFlows(dir)].sort(), ['cinco', 'cuatro', 'dos', 'tres', 'uno']);
  });
});

test('marca --network literal fuera de la convencion y permite variables', () => {
  flows({
    'a.yml': 'docker run --network host x',
    'b.yml': 'docker run --network=bridge x',
    'c.yml': 'docker run --network "${WORKER_NETWORK:?falta}" x',
    'd.yml': 'docker run --network worker-egress-ok x',
    'e.yml': 'docker run --network none x',
  }, (dir) => {
    const fuera = redesFueraDeConvencion(dir);
    assert.equal(fuera.length, 2);
    assert.match(fuera.join('\n'), /host/);
    assert.match(fuera.join('\n'), /bridge/);
  });
});

test('cubre --net, network_mode/networkMode, continuacion de linea y $(...)', () => {
  flows({
    'a.yml': 'docker run --net=host x',
    'b.yml': 'docker run --net host x',
    'c.yml': 'services:\n  w:\n    network_mode: host',
    'd.yml': 'networkMode: "host"',
    'e.yml': 'docker run --network \\\n   bridge \\\n x',
    'f.yml': 'docker run --network=$(calcular_red) x',
    'ok1.yml': 'docker run --net=worker-egress-ok --network "${WORKER_NETWORK:?falta}" x',
    'ok2.yml': 'network_mode: worker-egress-ok',
  }, (dir) => {
    const fuera = redesFueraDeConvencion(dir).join('\n');
    for (const esperado of ['a.yml', 'b.yml', 'c.yml', 'd.yml', 'e.yml', 'f.yml']) assert.match(fuera, new RegExp(esperado.replace('.', '\\.')));
    assert.doesNotMatch(fuera, /ok\d\.yml/);
  });
});

test('redes evasivas: --network=\\ + salto + host y ${NET:-host}; valores por defecto validos', () => {
  flows({
    'a.yml': 'docker run --network=\\\n   host x',
    'b.yml': 'docker run --network "${NET:-host}" x',
    'c.yml': 'docker run --network "${NET:=bridge}" x',
    'ok1.yml': 'docker run --network "${NET:-worker-egress-ok}" x',
    'ok2.yml': 'docker run --network "${WORKER_NETWORK:?Debe configurarse}" x',
    'ok3.yml': 'docker run --network "${NET}" x',
  }, (dir) => {
    const fuera = redesFueraDeConvencion(dir).join('\n');
    for (const esperado of ['a.yml', 'b.yml', 'c.yml']) assert.match(fuera, new RegExp(esperado.replace('.', '\\.')));
    assert.doesNotMatch(fuera, /ok\d\.yml/);
  });
});
