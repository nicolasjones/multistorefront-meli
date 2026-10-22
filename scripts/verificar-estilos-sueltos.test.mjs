import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analizar, revisarPaginas } from './verificar-estilos-sueltos.mjs'

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
  assert.deepEqual(analizar('height: 1, // estilos-sueltos: ok: utilidad de accesibilidad', PANTALLA), [])
})

test('las pantallas del repositorio están limpias (FR-015)', () => {
  assert.deepEqual(revisarPaginas(), [])
})
