import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analizar, OBJETIVOS, revisarPaginas } from './verificar-estilos-sueltos.mjs'

const PANTALLA = 'apps/web/src/pages/ejemplo/list.tsx'

test('detecta colores sueltos (hex/rgba/hsl) en una pantalla', () => {
  const hallazgos = analizar("const estilo = { color: '#FF0000', fondo: 'rgba(0,0,0,0.5)' }", PANTALLA)
  assert.equal(hallazgos.length, 1)
  assert.match(hallazgos[0].motivo, /color suelto/)
})

test('detecta radios, alturas y fontSize sueltos', () => {
  const hallazgos = analizar("sx={{ borderRadius: 12, height: 48, fontSize: '2rem' }}", PANTALLA)
  assert.deepEqual(hallazgos.map((h) => h.motivo.split(' ')[0]), ['borderRadius', 'height', 'fontSize'])
})

test('no marca el uso de tokens, variantes ni porcentajes', () => {
  assert.deepEqual(analizar('sx={{ borderRadius: `${tema.shape.borderRadius}px`, height: \'100%\', lineHeight: 1.5, color: tokens.color.accion }}', PANTALLA), [])
})

test('las rutas dueñas de los valores quedan exentas', () => {
  assert.deepEqual(analizar("color: '#FF0000'", 'apps/web/src/tema/tokens.ts'), [])
  assert.deepEqual(analizar("color: '#FF0000'", 'apps/web/src/components/base/EtiquetaEstado.tsx'), [])
  assert.deepEqual(analizar("color: '#FF0000'", 'apps/web/src/components/pagina/ContenidoAdaptable.tsx'), [])
})

test('los tests quedan exentos', () => {
  assert.deepEqual(analizar("color: '#FF0000'", 'apps/web/src/pages/ejemplo/list.test.tsx'), [])
})

test('la supresión en línea permite utilidades justificadas', () => {
  assert.deepEqual(analizar('height: 48, // estilos-sueltos: ok: medida de un tercero', PANTALLA), [])
})

test('prohíbe width/height: 1 (100 % en sx de MUI) en pages y components, sin supresión; pasa con SOLO_LECTORES o 1px', () => {
  const malo = "const x = { position: 'absolute', width: 1, height: 1, overflow: 'hidden' }"
  for (const ruta of [PANTALLA, 'apps/web/src/components/navegacion/Algo.tsx', 'apps/web/src/components/base/Otro.tsx']) {
    assert.deepEqual(analizar(malo, ruta).filter((h) => h.motivo.includes('100 %')).map((h) => h.motivo.split(':')[0]), ['width', 'height'], ruta)
  }
  assert.equal(analizar("sx={{ minWidth: 1, maxHeight: 1 }}", PANTALLA).length, 2)
  assert.equal(analizar('width: 1, // estilos-sueltos: ok: utilidad', PANTALLA).filter((h) => h.motivo.includes('100 %')).length, 1, 'no admite supresión')
  // Mutación: sin el literal pasa.
  assert.deepEqual(analizar("sx={SOLO_LECTORES}", PANTALLA), [])
  const de100 = (c) => analizar(c, PANTALLA).filter((h) => h.motivo.includes('100 %'))
  assert.deepEqual(de100("sx={{ width: '1px', height: '1px', flex: 1, lineHeight: 1, opacity: 1 }}"), [])
  assert.deepEqual(de100("width: 1.5, height: 100, maxWidth: '100%'"), [])
  // Solo la definición del helper queda exenta.
  assert.deepEqual(analizar('width: 1', 'apps/web/src/components/base/solo-lectores.ts'), [])
})

test('la regla width/height: 1 vale en todo apps/web/src (lib, tema, components) y el recorrido cubre todo src', () => {
  for (const ruta of ['apps/web/src/lib/x.ts', 'apps/web/src/tema/x.ts', 'apps/web/src/components/navegacion/Algo.tsx', 'apps/web/src/providers/x.tsx']) {
    assert.equal(analizar('const e = { width: 1 }', ruta).length, 1, ruta)
  }
  // Las reglas de color y dimensión siguen siendo solo de pages.
  assert.deepEqual(analizar("const e = { height: 48, color: '#fff' }", 'apps/web/src/lib/x.ts'), [])
  // Mutación: si el recorrido se achica a pages/ o components/, este caso falla.
  assert.ok(OBJETIVOS.some((o) => o.replace(/\\/g, '/').endsWith('apps/web/src')), 'recorre apps/web/src completo')
})

test('las pantallas del repositorio están limpias (FR-015)', () => {
  assert.deepEqual(revisarPaginas(), [])
})
