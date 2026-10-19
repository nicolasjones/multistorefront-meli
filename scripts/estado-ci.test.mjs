import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resumir } from './estado-ci.mjs';

describe('resumir (estado del CI)', () => {
  it('informa carriles, host y runners ocupados', () => {
    const texto = resumir({ carriles: 5, enUso: 2, load: 13.6, nucleos: 12, runners: [{ name: 'r1', busy: true }, { name: 'r2', busy: false }] });
    assert.match(texto, /Carriles CI: 2\/5 en uso/);
    assert.match(texto, /load 13\.60 sobre 12 núcleo\(s\) — saturado/);
    assert.match(texto, /Runners: 1\/2 ocupados/);
    assert.match(texto, /r1 ocupado/);
    assert.match(texto, /r2 libre/);
  });

  it('avisa cuando la admisión está apagada y no hay gh', () => {
    const texto = resumir({ carriles: 0, enUso: 0, load: 1, nucleos: 4, runners: null });
    assert.match(texto, /admisión desactivada/);
    assert.match(texto, /sin datos/);
  });
});
