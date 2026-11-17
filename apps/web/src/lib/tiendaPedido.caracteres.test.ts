import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENSAJE_CARACTERES, validarPedido } from './tiendaPedido'

// El conjunto de caracteres bloqueados vive en DOS lugares: el SQL de la migración del cierre (H-6) y el front. Cada uno tiene
// su prueba (el pgTAP prueba el del servidor, el Vitest el del front), pero si uno queda viejo nadie se entera: la persona
// escribe algo que el front acepta y el servidor rechaza (o al revés). Este test compara los DOS conjuntos carácter por
// carácter sobre todo el BMP: el del servidor manda y el front tiene que avisar exactamente lo mismo.
const MIGRACIONES = join(__dirname, '../../../../supabase/migrations')
const ARCHIVO_SQL = readdirSync(MIGRACIONES).find((nombre) => nombre.endsWith('_tienda_caracteres_invisibles.sql'))

function constanteDelSql(nombre: string): string[] {
  const sql = readFileSync(join(MIGRACIONES, ARCHIVO_SQL as string), 'utf8')
  return [...sql.matchAll(new RegExp(`${nombre}\\s+constant text := '(\\[[^']*\\])'`, 'g'))].map((m) => m[1])
}

// La clase de caracteres del SQL, como expresión regular (mismo lenguaje de clases que el del front).
const claseDe = (cuerpo: string) => new RegExp(`[${cuerpo.slice(1, -1)}]`)

// El front: el mismo carácter está bloqueado si `validarPedido` lo rechaza con el mensaje de caracteres.
const frontBloqueaLinea = (caracter: string) =>
  validarPedido({ nombre: `a${caracter}a`, contacto: 'ana@example.com', nota: '' }, false).nombre === MENSAJE_CARACTERES
const frontBloqueaNota = (caracter: string) =>
  validarPedido({ nombre: 'Ana', contacto: 'ana@example.com', nota: `a${caracter}a` }, false).nota === MENSAJE_CARACTERES

describe('el conjunto de caracteres bloqueados es el mismo en el SQL y en el front (H-6)', () => {
  it('la migración del cierre define el conjunto (y no hay dos versiones distintas)', () => {
    expect(ARCHIVO_SQL).toBeDefined()
    const linea = constanteDelSql('c_prohibidos_linea')
    const nota = constanteDelSql('c_prohibidos_nota')
    // Las dos funciones (la lista de pedido y el presupuesto) definen el mismo conjunto.
    expect(linea.length).toBeGreaterThanOrEqual(2)
    expect(nota.length).toBeGreaterThanOrEqual(2)
    expect(new Set(linea).size).toBe(1)
    expect(new Set(nota).size).toBe(1)
  })

  it('el nombre y el contacto: el front bloquea exactamente los mismos caracteres que el servidor', () => {
    const servidor = claseDe(constanteDelSql('c_prohibidos_linea')[0])
    const distintos: string[] = []
    for (let codigo = 0; codigo <= 0xffff; codigo += 1) {
      const caracter = String.fromCharCode(codigo)
      if (servidor.test(caracter) !== frontBloqueaLinea(caracter)) distintos.push(`U+${codigo.toString(16).toUpperCase().padStart(4, '0')}`)
    }
    expect(distintos).toEqual([])
  })

  it('la nota: el front bloquea exactamente los mismos caracteres que el servidor (el salto de línea se acepta)', () => {
    const servidor = claseDe(constanteDelSql('c_prohibidos_nota')[0])
    const distintos: string[] = []
    for (let codigo = 0; codigo <= 0xffff; codigo += 1) {
      const caracter = String.fromCharCode(codigo)
      if (servidor.test(caracter) !== frontBloqueaNota(caracter)) distintos.push(`U+${codigo.toString(16).toUpperCase().padStart(4, '0')}`)
    }
    expect(distintos).toEqual([])
  })
})
