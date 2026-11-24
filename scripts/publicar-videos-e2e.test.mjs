// Spec 022: la página del run agrupa por historia y referencia los videos.
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { copiarVideos, paginaRun } from './publicar-videos-e2e.mjs';

const manifiesto = {
  run_id: 'r1',
  fecha: '2026-10-21T00:00:00Z',
  modo: 'on',
  evidencias: [
    {
      epica: 'MSF-119', epicaNombre: 'MSF-119 — Acceso', spec: 's/a', specTitulo: 'Acceso y organización',
      items: [{ id: 'T020', hecho: true, texto: 'E2E ingreso', ambiguo: false }],
      test: '[MSF-119:T020] ingreso', archivo: 'e2e/a.e2e.ts', estado: 'pasado', video: 't1/video.webm',
    },
  ],
  huerfanos: [{ test: 'suelto', motivo: 'sin etiqueta [EPICA:TASK]' }],
  sin_cubrir: [],
  items_sin_descripcion: [{ id: 'T021', spec: 's/a', specTitulo: 'Acceso y organización', motivo: 'sin texto' }],
};

describe('publicar-videos-e2e', () => {
  it('la página agrupa por historia con reproductor y huérfanos', () => {
    const html = paginaRun(manifiesto);
    assert.match(html, /Acceso y organización/);
    assert.match(html, /<video[^>]*src="t1\/video\.webm"/);
    assert.match(html, /\[T020\] E2E ingreso ✓/);
    assert.match(html, /Sin etiqueta válida/);
    // MSF-907: los ítems sin descripción utilizable quedan a la vista, con su motivo.
    assert.match(html, /Ítems sin descripción utilizable/);
    assert.match(html, /\[T021\] Acceso y organización — sin texto/);
  });

  it('escapa el HTML de specTitulo y motivo (vienen de specs y del manifiesto)', () => {
    const html = paginaRun({
      ...manifiesto,
      evidencias: [{ ...manifiesto.evidencias[0], specTitulo: '<script>alert(1)</script>' }],
      items_sin_descripcion: [{ id: 'T9', specTitulo: '<b>x</b>', motivo: '<img src=x onerror=1>' }],
    });
    assert.doesNotMatch(html, /<script>alert|<b>x<|<img src=x/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=1&gt;/);
  });

  it('copia solo webm preservando rutas relativas', () => {
    const base = mkdtempSync(join(tmpdir(), 'pub-'));
    mkdirSync(join(base, 'origen', 't1'), { recursive: true });
    writeFileSync(join(base, 'origen', 't1', 'video.webm'), 'x');
    writeFileSync(join(base, 'origen', 't1', 'trace.zip'), 'y');
    const copiados = copiarVideos(join(base, 'origen'), join(base, 'dest'));
    assert.deepEqual(copiados, [join('t1', 'video.webm')]);
    assert.ok(existsSync(join(base, 'dest', 't1', 'video.webm')));
    assert.ok(!existsSync(join(base, 'dest', 't1', 'trace.zip')));
  });
});
