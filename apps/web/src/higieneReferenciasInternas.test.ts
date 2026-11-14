import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AYUDA_CANAL_ML } from './lib/ventas'

// Higiene: los nombres de test describen comportamiento (no tickets) y el código no habla de «Etapa N».
const raiz = path.resolve(__dirname)

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) return archivos(p)
    return /\.(ts|tsx)$/.test(n) && n !== path.basename(__filename) ? [p] : []
  })
}

const TITULO_CON_TICKET = /^\s*(?:describe|it|test)(?:\.\w+)?\((['"`])[^'"`]*MSF-\d+/

describe('referencias internas en apps/web/src', () => {
  const todos = archivos(raiz)

  it('ningún nombre de describe/it/test cita un código MSF', () => {
    const malos = todos.flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (TITULO_CON_TICKET.test(l) ? [`${path.relative(raiz, f)}:${i + 1}`] : [])))
    expect(malos).toEqual([])
  })

  it('ningún archivo menciona «Etapa N»', () => {
    const malos = todos.filter((f) => /Etapa \d/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(raiz, f))
    expect(malos).toEqual([])
  })

  it('la ayuda del canal Mercado Libre no lleva códigos de ticket ni de etapa', () => {
    expect(AYUDA_CANAL_ML).not.toMatch(/MSF-\d+|Etapa \d/)
  })
})
