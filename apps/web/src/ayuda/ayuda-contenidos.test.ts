import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { AYUDA_POR_DESTINO } from './contenidos'
import { AYUDA_MAX_PASO, AYUDA_MAX_PASOS, AYUDA_MAX_RESUMEN } from './tipos'

// FR-024: la ayuda es breve, en castellano y sin términos técnicos.
const TECNICOS = /\b(rpc|endpoint|rls|api|json|sql|feature|supabase|kestra|webhook|token|backend|frontend|query|payload)\b/i

describe('contenidos de ayuda (FR-024)', () => {
  const entradas = Object.entries(AYUDA_POR_DESTINO)

  it('el título coincide con la etiqueta del menú', () => {
    for (const [id, c] of entradas) {
      const destino = DESTINOS_PANEL.find((d) => d.id === id)
      expect(c.titulo, id).toBe(destino?.etiqueta)
    }
  })

  it(`el resumen no está vacío y tiene como máximo ${AYUDA_MAX_RESUMEN} caracteres`, () => {
    for (const [id, c] of entradas) {
      expect(c.resumen.trim().length, `${id}: resumen vacío`).toBeGreaterThan(0)
      expect(c.resumen.length, `${id}: resumen largo`).toBeLessThanOrEqual(AYUDA_MAX_RESUMEN)
    }
  })

  it(`hay como máximo ${AYUDA_MAX_PASOS} pasos de ${AYUDA_MAX_PASO} caracteres y ninguno vacío ni repetido`, () => {
    for (const [id, c] of entradas) {
      const pasos = c.pasos ?? []
      expect(pasos.length, `${id}: demasiados pasos`).toBeLessThanOrEqual(AYUDA_MAX_PASOS)
      for (const p of pasos) {
        expect(p.trim().length, `${id}: paso vacío`).toBeGreaterThan(0)
        expect(p.length, `${id}: paso largo «${p.slice(0, 30)}…»`).toBeLessThanOrEqual(AYUDA_MAX_PASO)
      }
      expect(new Set(pasos).size, `${id}: pasos repetidos`).toBe(pasos.length)
    }
  })

  it('no usa términos técnicos', () => {
    for (const [id, c] of entradas) {
      const texto = [c.titulo, c.resumen, ...(c.pasos ?? [])].join(' ')
      expect(texto, id).not.toMatch(TECNICOS)
    }
  })
})
