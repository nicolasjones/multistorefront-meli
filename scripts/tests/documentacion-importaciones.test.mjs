import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// F-IMP-01 (FR-017): el contrato para workers y la guía del centro nombran el protocolo completo.
const documentos = ['workers/CONTRATO.md', 'docs/importaciones.md']
const funciones = [
  'iniciar_proceso_masivo',
  'actualizar_progreso_proceso_masivo',
  'registrar_error_proceso_masivo',
  'proceso_masivo_cancelado',
  'cerrar_proceso_masivo',
]

for (const documento of documentos) {
  test(`${documento} documenta el protocolo de procesos masivos`, () => {
    const texto = readFileSync(new URL(`../../${documento}`, import.meta.url), 'utf8')
    for (const funcion of funciones) assert.ok(texto.includes(funcion), `${documento} no nombra ${funcion}`)
  })
}

test('la guía aclara que no se migran cargas existentes', () => {
  const texto = readFileSync(new URL('../../docs/importaciones.md', import.meta.url), 'utf8')
  assert.match(texto, /no migra cargas\s+existentes/)
})
