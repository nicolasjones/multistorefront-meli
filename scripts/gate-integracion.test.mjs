// El gate de `dokploy` es un RULESET, no «branch protection»: el endpoint
// `/branches/<rama>/protection` devuelve 404 «Branch not protected» aunque el
// ruleset esté activo. Estos tests fijan la decisión del diagnóstico (rama al
// día exigida o no) y la trampa del 404, para que el ciclo infinito de
// «not up to date» → resincronizar → BEHIND no vuelva.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { aplicaA, estadoDeGh, gateDe, gateDesdeRespuestas, informe } from './gate-integracion.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Payload real de la lista de rulesets (GET /repos/<owner>/<repo>/rulesets):
// la lista NO trae `conditions` ni `rules`, hay que leer el detalle de cada uno.
const LISTA = [
  {
    id: 25358575,
    name: 'dokploy-integracion-protegida',
    target: 'branch',
    source_type: 'Repository',
    source: 'nicolasjones/multistorefront-meli',
    enforcement: 'active',
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    node_id: 'RRS_lACgUmVtZW',
  },
];

// Ruleset real del repo (GET /repos/<owner>/<repo>/rulesets/25358575).
const RULESET = {
  id: 25358575,
  name: 'dokploy-integracion-protegida',
  target: 'branch',
  source_type: 'Repository',
  source: 'nicolasjones/multistorefront-meli',
  enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/dokploy'], exclude: [] } },
  rules: [
    {
      type: 'required_status_checks',
      parameters: {
        do_not_enforce_on_create: false,
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: 'validacion' }],
      },
    },
  ],
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
};

const rulesetCon = (cambios) => ({ ...RULESET, ...cambios });

// Respuesta de la API con el detalle ya leído (lo que devuelve `gh api`).
const detalleOk = (data) => ({ ok: true, http: 200, data });
const detalleFallido = (http) => ({ ok: false, http, data: null });

// La protección clásica de `dokploy` devuelve 404 «Branch not protected».
const SIN_PROTECCION_CLASICA = { http: 404, data: { message: 'Branch not protected', status: '404' } };

describe('gateDe (gate efectivo por rulesets)', () => {
  it('lee el check requerido, el bypass y que «rama al día» NO está exigida', () => {
    const gate = gateDe([RULESET], 'dokploy');
    assert.equal(gate.hayGate, true);
    assert.equal(gate.ramaAlDia, false);
    assert.equal(gate.colaDeMerge, false);
    assert.deepEqual(gate.checks, ['validacion']);
    assert.deepEqual(gate.bypass, ['RepositoryRole 5 (bypass_mode: always)']);
  });

  it('detecta «rama al día» exigida y la regla de cola de merge', () => {
    const gate = gateDe(
      [
        rulesetCon({
          rules: [
            {
              type: 'required_status_checks',
              parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validacion' }] },
            },
            { type: 'merge_queue' },
          ],
        }),
      ],
      'dokploy',
    );
    assert.equal(gate.ramaAlDia, true);
    assert.equal(gate.colaDeMerge, true);
  });

  it('ignora los rulesets que no cubren la rama, los que no están activos y los de otra base', () => {
    const gate = gateDe(
      [
        rulesetCon({ id: 1, enforcement: 'disabled' }),
        rulesetCon({ id: 2, conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } }),
        rulesetCon({ id: 3, target: 'tag' }),
      ],
      'dokploy',
    );
    assert.equal(gate.hayGate, false);
    assert.equal(gate.ramaAlDia, false);
  });

  it('aplica el include/exclude de ref_name', () => {
    assert.equal(aplicaA(RULESET, 'dokploy'), true);
    assert.equal(aplicaA(RULESET, 'main'), false);
    const excluido = rulesetCon({ conditions: { ref_name: { include: ['refs/heads/dokploy'], exclude: ['refs/heads/dokploy'] } } });
    assert.equal(aplicaA(excluido, 'dokploy'), false);
    const sinInclude = rulesetCon({ conditions: { ref_name: { include: [], exclude: [] } } });
    assert.equal(aplicaA(sinInclude, 'cualquiera'), true);
  });

  it('aplica los include/exclude que son patrones fnmatch, no nombres exactos', () => {
    const porPatron = (include, exclude = []) => rulesetCon({ conditions: { ref_name: { include, exclude } } });
    // `refs/heads/*` cubre cualquier rama de primer nivel.
    assert.equal(aplicaA(porPatron(['refs/heads/*']), 'dokploy'), true);
    // `**` cruza `/`: `refs/heads/release/**` cubre `release/2026/01`.
    assert.equal(aplicaA(porPatron(['refs/heads/release/**']), 'release/2026/01'), true);
    assert.equal(aplicaA(porPatron(['refs/heads/release/**']), 'dokploy'), false);
    // El exclude también es patrón.
    assert.equal(aplicaA(porPatron(['refs/heads/*'], ['refs/heads/dokploy']), 'dokploy'), false);
    assert.equal(aplicaA(porPatron(['refs/heads/*'], ['refs/heads/dok*']), 'dokploy'), false);
    // Los tokens de la API: `~ALL` incluye todas las ramas.
    assert.equal(aplicaA(porPatron(['~ALL']), 'cualquiera/una'), true);
    // `~DEFAULT_BRANCH` incluye la rama por defecto del repo.
    assert.equal(aplicaA(porPatron(['~DEFAULT_BRANCH']), 'main', 'main'), true);
    assert.equal(aplicaA(porPatron(['~DEFAULT_BRANCH']), 'dokploy', 'main'), false);
  });
});

describe('estadoDeGh (código de salida y cuerpo → estado HTTP)', () => {
  it('una llamada exitosa es 200 (no 0): es lo que hace posible leer la protección clásica', () => {
    assert.deepEqual(estadoDeGh(0, { required_status_checks: { strict: true } }), { ok: true, http: 200 });
    assert.deepEqual(estadoDeGh(0, []), { ok: true, http: 200 });
  });

  it('un error de la API toma el estado HTTP del cuerpo', () => {
    assert.deepEqual(estadoDeGh(1, { message: 'Branch not protected', status: '404' }), { ok: false, http: 404 });
    assert.deepEqual(estadoDeGh(1, { status: '403' }), { ok: false, http: 403 });
  });

  it('un fallo sin cuerpo HTTP queda en 0 (no se puede afirmar nada)', () => {
    assert.deepEqual(estadoDeGh(1, null), { ok: false, http: 0 });
    assert.deepEqual(estadoDeGh(1, { message: 'sin estado' }), { ok: false, http: 0 });
  });
});

describe('gateDesdeRespuestas (lectura de la API)', () => {
  it('arma el gate con el payload real del ruleset y el 404 de la protección clásica', () => {
    const { gate, proteccionClasica404 } = gateDesdeRespuestas({
      lista: LISTA,
      detalles: new Map([[25358575, detalleOk(RULESET)]]),
      proteccionClasica: SIN_PROTECCION_CLASICA,
      rama: 'dokploy',
    });
    assert.equal(gate.hayGate, true);
    assert.equal(gate.ramaAlDia, false);
    assert.deepEqual(gate.checks, ['validacion']);
    assert.equal(proteccionClasica404, true);
  });

  it('falla ruidosamente si no se pudo leer el detalle de un ruleset (no dice «sin gate»)', () => {
    assert.throws(
      () =>
        gateDesdeRespuestas({
          lista: LISTA,
          detalles: new Map([[25358575, detalleFallido(500)]]),
          proteccionClasica: SIN_PROTECCION_CLASICA,
          rama: 'dokploy',
        }),
      /No se pudo leer el detalle de 1 ruleset/,
    );
  });

  it('la protección clásica con 200 ES un gate: no se informa «sin gate»', () => {
    const { gate, proteccionClasica404 } = gateDesdeRespuestas({
      lista: [],
      detalles: new Map(),
      proteccionClasica: {
        http: 200,
        data: { required_status_checks: { strict: false, contexts: ['validacion'], checks: [] } },
      },
      rama: 'dokploy',
    });
    assert.equal(gate.hayGate, true);
    assert.equal(proteccionClasica404, false);
    assert.deepEqual(gate.checks, ['validacion']);
    const { estado, lineas } = informe({ gate });
    assert.notEqual(estado, 'sin-gate');
    assert.match(lineas.join('\n'), /protección clásica/);
  });

  it('la protección clásica con «strict» exige «rama al día»', () => {
    const { gate } = gateDesdeRespuestas({
      lista: [],
      detalles: new Map(),
      proteccionClasica: { http: 200, data: { required_status_checks: { strict: true, contexts: [] } } },
      rama: 'dokploy',
    });
    assert.equal(gate.ramaAlDia, true);
  });

  it('falla ruidosamente si no se pudo leer la protección clásica', () => {
    assert.throws(
      () =>
        gateDesdeRespuestas({
          lista: LISTA,
          detalles: new Map([[25358575, detalleOk(RULESET)]]),
          proteccionClasica: { http: 0, data: null },
          rama: 'dokploy',
        }),
      /protección clásica/,
    );
  });

  it('falla ruidosamente si la protección clásica responde 200 sin cuerpo', () => {
    assert.throws(
      () =>
        gateDesdeRespuestas({
          lista: LISTA,
          detalles: new Map([[25358575, detalleOk(RULESET)]]),
          proteccionClasica: { http: 200, data: null },
          rama: 'dokploy',
        }),
      /respondió 200 sin cuerpo/,
    );
  });
});

describe('informe (veredicto del gate)', () => {
  it('con «rama al día» exigida y la rama atrás dice que el merge va a fallar', () => {
    const gate = gateDe([rulesetCon({ rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validacion' }] } }] })], 'dokploy');
    const { estado, lineas } = informe({ gate, atras: 3 });
    assert.equal(estado, 'bloqueado');
    const texto = lineas.join('\n');
    assert.match(texto, /BLOQUEADO/);
    assert.match(texto, /head branch is not up to date/);
    assert.match(texto, /strict_required_status_checks_policy: false/);
    assert.match(texto, /merge_queue/);
  });

  it('sin «rama al día» NO pide resincronizar la rama aunque esté atrás', () => {
    const gate = gateDe([RULESET], 'dokploy');
    const { estado, lineas } = informe({ gate, atras: 3 });
    assert.equal(estado, 'no-bloqueado');
    const texto = lineas.join('\n');
    assert.match(texto, /NO se rechaza por desfasaje/);
    assert.match(texto, /no actualices la rama/);
    assert.doesNotMatch(texto, /actualizar la rama reinicia el CI/);
    assert.doesNotMatch(texto, /BLOQUEADO/);
  });

  it('sin PR y con «rama al día» desactivada, el veredicto dice que no hay que actualizar la rama', () => {
    const gate = gateDe([RULESET], 'dokploy');
    const { estado, lineas } = informe({ gate });
    assert.equal(estado, 'no-bloqueado');
    assert.match(lineas.join('\n'), /NO se rechaza por desfasaje/);
  });

  it('sin PR y con «rama al día» exigida, el veredicto avisa del ciclo y de cómo mirarlo', () => {
    const gate = gateDe([rulesetCon({ rules: [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validacion' }] } }] })], 'dokploy');
    const { lineas } = informe({ gate });
    const texto = lineas.join('\n');
    assert.match(texto, /Veredicto:/);
    assert.match(texto, /head branch is not up to date/);
    assert.match(texto, /--pr <n>/);
  });

  it('la trampa del 404: con ruleset activo el informe NO dice que no hay protección', () => {
    const gate = gateDe([RULESET], 'dokploy');
    const { lineas } = informe({ gate, proteccionClasica404: true });
    const texto = lineas.join('\n');
    assert.match(texto, /Branch not protected/);
    assert.match(texto, /dokploy-integracion-protegida/);
    assert.match(texto, /25358575/);
    assert.match(texto, /validacion/);
    assert.doesNotMatch(texto, /no hay gate/i);
  });

  it('sin ruleset y con 404 en el endpoint clásico sí se dice que no hay gate', () => {
    const { estado, lineas } = informe({ gate: gateDe([], 'dokploy'), proteccionClasica404: true });
    assert.equal(estado, 'sin-gate');
    const texto = lineas.join('\n');
    assert.match(texto, /No hay ruleset activo/);
    assert.match(texto, /la protección clásica/);
  });
});

describe('runbooks (docs/control-ci.md y docs/tecnico/runbooks/ci-trabado.md)', () => {
  const controlCi = readFileSync(path.join(RAIZ, 'docs/control-ci.md'), 'utf8');
  const ciTrabado = readFileSync(path.join(RAIZ, 'docs/tecnico/runbooks/ci-trabado.md'), 'utf8');
  // El texto del manual se envuelve a lo ancho: se comparan los espacios normalizados.
  const planoControlCi = controlCi.replace(/\s+/g, ' ');
  const planoCiTrabado = ciTrabado.replace(/\s+/g, ' ');

  it('control-ci.md documenta el endpoint correcto (rulesets) y la trampa del 404', () => {
    assert.match(planoControlCi, /rulesets/);
    assert.match(planoControlCi, /Branch not protected/);
  });

  it('control-ci.md no manda a resincronizar la rama cuando el merge falla por desfasaje', () => {
    assert.doesNotMatch(planoControlCi, /actualizar la rama y reintentar/);
  });

  it('el runbook de CI trabado manda a mirar el gate, no a actualizar la rama', () => {
    assert.match(planoCiTrabado, /pnpm ci:gate/);
    assert.doesNotMatch(planoCiTrabado, /actualizar la rama/i);
  });
});
