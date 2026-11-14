import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AYUDA_CANAL_ML } from './lib/ventas'

// Higiene: los nombres de test describen comportamiento (no tickets) y el código no habla de «Etapa N».
const raiz = path.resolve(__dirname)
const TICKET = /MSF-\d+/

// Salta espacios y saltos de línea desde `i`.
function saltarEspacios(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++
  return i
}

// Devuelve el índice posterior al cierre del grupo que abre en `i` (paréntesis o corchete), respetando literales.
function cerrarGrupo(s: string, i: number): number {
  const abre = s[i]
  const cierra = abre === '(' ? ')' : abre === '[' ? ']' : '}'
  let nivel = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') { i = finLiteral(s, i) - 1; continue }
    if (c === abre) nivel++
    else if (c === cierra && --nivel === 0) return i + 1
  }
  return s.length
}

// Índice posterior al cierre del literal que abre en `i` (la comilla de apertura es la que cierra: admite comillas mixtas).
function finLiteral(s: string, i: number): number {
  const q = s[i]
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === q) return j + 1
  }
  return s.length
}

const LLAMADA = /\b(?:it|test|describe)(?:\.\w+)*\s*(?=[(`])/g

/** Números de línea (desde 1) de cada `it`/`test`/`describe` cuyo primer literal de título cita un código MSF. */
export function titulosConTicket(fuente: string): number[] {
  const lineas: number[] = []
  for (const m of fuente.matchAll(LLAMADA)) {
    let i = m.index + m[0].length
    // `.each` con tabla de plantilla: it.each`...`(título)
    if (fuente[i] === '`') i = saltarEspacios(fuente, finLiteral(fuente, i))
    if (fuente[i] !== '(') continue
    let j = saltarEspacios(fuente, i + 1)
    // `.each([...])(título)`: el primer grupo no es el título; se salta y se sigue con el segundo.
    if (/\.each\s*$/.test(m[0].trimEnd()) && !/['"`]/.test(fuente[j])) {
      const k = saltarEspacios(fuente, cerrarGrupo(fuente, i))
      if (fuente[k] !== '(') continue
      j = saltarEspacios(fuente, k + 1)
    }
    if (!/['"`]/.test(fuente[j])) continue
    const literal = fuente.slice(j, finLiteral(fuente, j))
    if (TICKET.test(literal)) lineas.push(fuente.slice(0, j).split('\n').length)
  }
  return lineas
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) return archivos(p)
    return /\.(ts|tsx)$/.test(n) && n !== path.basename(__filename) ? [p] : []
  })
}

describe('titulosConTicket (el guardián detecta cada forma de título)', () => {
  const casos: Array<[string, string]> = [
    ['it simple', "it('hace algo (MSF-1)', () => {})"],
    ['test simple', 'test("hace algo (MSF-12)", () => {})'],
    ['describe con plantilla', 'describe(`grupo [MSF-423:T028]`, () => {})'],
    ['prefijo entre corchetes', "it('[MSF-423:T028] hace algo', () => {})"],
    ['it.skip', "it.skip('hace algo (MSF-1)', () => {})"],
    ['describe.only', "describe.only('grupo (MSF-1)', () => {})"],
    ['it.each con tabla', "it.each([1, 2])('caso %s (MSF-598)', (n) => {})"],
    ['it.each de varias líneas', "it.each([\n  ['a', 1],\n  ['b', 2],\n])(\n  'caso %s (MSF-598)',\n  (n) => {})"],
    ['describe.each', "describe.each(['a', 'b'] as const)('grupo %s (MSF-9)', () => {})"],
    ['it.skip.each', "it.skip.each([1])('caso (MSF-3)', () => {})"],
    ['it.each con plantilla', 'it.each`\n  a | b\n  ${1} | ${2}\n`(\'caso (MSF-4)\', () => {})'],
    ['título en la línea siguiente', "it(\n  'hace algo (MSF-1)',\n  () => {},\n)"],
    ['comillas mixtas', `it('muestra "x" (MSF-1)', () => {})`],
    ['comillas dobles con apóstrofo', `it("no muestra 'x' (MSF-1)", () => {})`],
  ]
  it.each(casos)('detecta: %s', (_nombre, fuente) => {
    expect(titulosConTicket(fuente)).toHaveLength(1)
  })

  it('informa la línea del título aunque empiece en la línea siguiente', () => {
    expect(titulosConTicket("// cabecera\nit(\n  'x (MSF-1)',\n  () => {},\n)")).toEqual([3])
  })

  it.each([
    ['título limpio', "it('hace algo', () => {})"],
    ['código MSF solo en el cuerpo', "it('hace algo', () => { expect(a).not.toMatch(/MSF-\\d+/) })"],
    ['código MSF en un comentario', "// MSF-1\nit('hace algo', () => {})"],
    ['it.each limpio con MSF en los datos', "it.each(['MSF-1'])('caso %s', () => {})"],
    ['título que no es literal', 'it(titulo, () => {})'],
    ['palabra que termina en it', "edit('MSF-1')"],
  ])('no marca: %s', (_nombre, fuente) => {
    expect(titulosConTicket(fuente)).toEqual([])
  })
})

describe('referencias internas en apps/web/src', () => {
  const todos = archivos(raiz)

  it('ningún nombre de describe/it/test cita un código MSF', () => {
    const malos = todos.flatMap((f) => titulosConTicket(readFileSync(f, 'utf8')).map((n) => `${path.relative(raiz, f)}:${n}`))
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
