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

import { aplicaA, gateDe, informe } from './gate-integracion.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ruleset real del repo (GET /repos/nicolasjones/multistorefront-meli/rulesets/25358575).
const RULESET = {
  id: 25358575,
  name: 'dokploy-integracion-protegida',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/dokploy'], exclude: [] } },
  rules: [
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: 'validacion' }],
      },
    },
  ],
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
};

const rulesetCon = (cambios) => ({ ...RULESET, ...cambios });

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

describe('runbook (docs/control-ci.md)', () => {
  const doc = readFileSync(path.join(RAIZ, 'docs/control-ci.md'), 'utf8');
  // El texto del manual se envuelve a lo ancho: se comparan los espacios normalizados.
  const plano = doc.replace(/\s+/g, ' ');

  it('documenta el endpoint correcto (rulesets) y la trampa del 404', () => {
    assert.match(plano, /rulesets/);
    assert.match(plano, /Branch not protected/);
  });

  it('no manda a resincronizar la rama cuando el merge falla por desfasaje', () => {
    assert.doesNotMatch(plano, /actualizar la rama y reintentar/);
  });
});
