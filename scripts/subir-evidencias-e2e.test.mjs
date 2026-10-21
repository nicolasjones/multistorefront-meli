// Spec 022: las claves del bucket son ASCII; Playwright puede generar acentos.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { claveSegura, sanearManifiesto } from './subir-evidencias-e2e.mjs';

describe('subir-evidencias-e2e', () => {
  it('quita acentos y caracteres inválidos sin perder la carpeta', () => {
    assert.equal(
      claveSegura('permisos-por-empresa.e2e.t-fd882-ivel-de-edición-de-cada-una-chromium/video.webm'),
      'permisos-por-empresa.e2e.t-fd882-ivel-de-edicion-de-cada-una-chromium/video.webm',
    );
    assert.equal(claveSegura('a b/c (1)/v.webm'), 'a-b/c-1/v.webm');
    assert.equal(claveSegura('../../etc/passwd'), 'etc/passwd');
    assert.equal(claveSegura('ñandú/视频.webm'), 'nandu/x.webm');
  });

  it('reescribe la ruta del video en el manifiesto', () => {
    const manifiesto = { evidencias: [{ video: 'edición/video.webm' }, { video: null }] };
    sanearManifiesto(manifiesto);
    assert.deepEqual(manifiesto.evidencias, [{ video: 'edicion/video.webm' }, { video: null }]);
  });
});
