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

// Índice posterior al comentario o a la regex que abre en `i`, o `i` si ahí no hay ninguno.
function saltarComentarioORegex(s: string, i: number): number {
  if (s[i] !== '/') return i
  if (s[i + 1] === '/') { const f = s.indexOf('\n', i); return f < 0 ? s.length : f }
  if (s[i + 1] === '*') { const f = s.indexOf('*/', i + 2); return f < 0 ? s.length : f + 2 }
  // Regex literal: solo si el `/` sigue a un signo que no puede cerrar una expresión (heurística suficiente para los `.each`).
  let k = i - 1
  while (k >= 0 && /[ \t]/.test(s[k])) k--
  if (k >= 0 && !/[(,=:[{!&|?;\n]/.test(s[k])) return i
  let clase = false
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '[') clase = true
    else if (s[j] === ']') clase = false
    else if (s[j] === '/' && !clase) return j + 1
    else if (s[j] === '\n') return i
  }
  return i
}

// Devuelve el índice posterior al cierre del grupo que abre en `i` (paréntesis o corchete), respetando literales, comentarios y regex.
function cerrarGrupo(s: string, i: number): number {
  const abre = s[i]
  const cierra = abre === '(' ? ')' : abre === '[' ? ']' : '}'
  let nivel = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') { i = finLiteral(s, i) - 1; continue }
    if (c === '/') { const f = saltarComentarioORegex(s, i); if (f > i) { i = f - 1; continue } }
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

// Variantes que reciben un argumento antes del título: it.each([...])(título), it.skipIf(c)(título), it.for([...])(título).
const CON_ARGUMENTO_PREVIO = /\.(?:each|skipIf|runIf|for)$/
const LLAMADA = /\b(?:it|test|describe)(?:\.\w+)*/g

// Índice posterior a un argumento de tipo `<...>` (anidado) que empieza en `i`, o `i` si no hay.
function saltarGenericos(s: string, i: number): number {
  const k = saltarEspacios(s, i)
  if (s[k] !== '<') return i
  let nivel = 0
  for (let j = k; j < s.length; j++) {
    if (s[j] === '<') nivel++
    else if (s[j] === '>' && s[j - 1] !== '=' && --nivel === 0) return j + 1
    else if (s[j] === '\n' && j - k > 200) break
  }
  return i
}

/** Números de línea (desde 1) de cada `it`/`test`/`describe` cuyo primer literal de título cita un código MSF. */
export function titulosConTicket(fuente: string): number[] {
  const lineas: number[] = []
  for (const m of fuente.matchAll(LLAMADA)) {
    let i = saltarEspacios(fuente, saltarGenericos(fuente, m.index + m[0].length))
    // Tabla de plantilla: it.each`...`(título); después de la tabla viene directamente el título.
    const conTabla = fuente[i] === '`'
    if (conTabla) i = saltarEspacios(fuente, finLiteral(fuente, i))
    if (fuente[i] !== '(') continue
    let j = saltarEspacios(fuente, i + 1)
    // Con argumento previo el primer grupo no es el título; se salta y se sigue con el segundo.
    if (!conTabla && CON_ARGUMENTO_PREVIO.test(m[0])) {
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
    ['it.each con genérico de TS', "it.each<[number]>([[1]])('caso %s (MSF-1)', (n) => {})"],
    ['it.each con genérico anidado', "it.each<Array<[string, number]>>([['a', 1]])('caso (MSF-1)', () => {})"],
    ['it.skipIf', "it.skipIf(process.env.CI)('hace algo (MSF-1)', () => {})"],
    ['describe.runIf', "describe.runIf(cond)('grupo (MSF-1)', () => {})"],
    ['it.for', "it.for([1, 2])('caso %s (MSF-1)', (n) => {})"],
    ['apóstrofo en un comentario de la tabla', "it.each([\n  // no hay 'comilla cerrada\n  [1],\n])('caso (MSF-1)', () => {})"],
    ['comentario de bloque con comilla en la tabla', "it.each([\n  /* l'a */ [1],\n])('caso (MSF-1)', () => {})"],
    ['regex con comilla en la tabla', "it.each([/'x/, /\\d\"/])('caso (MSF-1)', () => {})"],
    ['regex con clase y barra en la tabla', "it.each([/[/']/])('caso (MSF-1)', () => {})"],
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
    ['it.each con genérico limpio', "it.each<[string]>([['MSF-1']])('caso %s', () => {})"],
    ['it.skipIf limpio con MSF en el argumento', "it.skipIf(a === 'MSF-1')('hace algo', () => {})"],
    ['it.for limpio', "it.for(['MSF-1'])('caso %s', () => {})"],
    ['MSF solo en un comentario de la tabla', "it.each([\n  // MSF-1\n  [1],\n])('caso', () => {})"],
    ['división que no es regex', "it.each([a / 2, 4 / 'x'.length])('caso', () => {})"],
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
