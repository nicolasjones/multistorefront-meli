import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluar } from './verificar-higiene-base.mjs';

describe('verificar-higiene-base.evaluar', () => {
  it('marca falla cuando un control que debe ser 0 no lo es', () => {
    const r = evaluar([{ control: 'fk_sin_indice', cantidad: 3, detalle: 'x' }]);
    assert.equal(r[0].ok, false);
  });
  it('acepta el valor esperado y los controles informativos', () => {
    const r = evaluar([
      { control: 'vistas_definer_permitidas', cantidad: 1, detalle: '' },
      { control: 'migraciones_registradas', cantidad: 753, detalle: '' },
    ]);
    assert.deepEqual(r.map((x) => x.ok), [true, true]);
  });
  it('una vista definer de más rompe el control', () => {
    assert.equal(evaluar([{ control: 'vistas_definer_permitidas', cantidad: 2, detalle: '' }])[0].ok, false);
  });
});
