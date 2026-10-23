import { readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analizarCsv } from '../../lib/migracionCsv'
import { CLIENTES_SINTETICOS, CSV_CLIENTES_SINTETICOS } from './clientesMigracion'
import { CSV_PROVEEDORES_SINTETICOS, PROVEEDORES_SINTETICOS } from './proveedoresMigracion'

// Guarda de datos de prueba (F-MIG-01, FR-012). Falla si una fixture introduce
// un correo fuera de los dominios reservados por RFC 2606 o un documento de 11
// dígitos que no sea evidentemente inventado (un solo dígito repetido), que es
// la forma en que se colaría un dato real en git.

// Vitest corre con cwd en `apps/web`; no se usa import.meta.url porque en jsdom es una URL http.
const DIRECTORIO = `${resolve(process.cwd(), 'src/test/fixtures')}${sep}`
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const DOCUMENTO = /\b\d{11}\b/g
const DOMINIO_RESERVADO = /@example\.(?:com|org|net|test)$/i

function archivosDeFixtures(): string[] {
  return readdirSync(DIRECTORIO)
    .filter((nombre) => nombre.endsWith('.ts') && !nombre.endsWith('.test.ts'))
    .sort()
}

describe('fixtures sintéticas', () => {
  it('los correos usan solo dominios reservados de ejemplo', () => {
    const correos = archivosDeFixtures().flatMap((nombre) =>
      (readFileSync(`${DIRECTORIO}${nombre}`, 'utf8').match(CORREO) ?? []).map((correo) => ({ nombre, correo })),
    )
    expect(correos.length).toBeGreaterThan(0)
    for (const { nombre, correo } of correos) {
      expect(correo, `${nombre} contiene un correo que no es de ejemplo`).toMatch(DOMINIO_RESERVADO)
    }
  })

  it('los documentos de 11 dígitos son evidentemente inventados', () => {
    const documentos = archivosDeFixtures().flatMap((nombre) =>
      (readFileSync(`${DIRECTORIO}${nombre}`, 'utf8').match(DOCUMENTO) ?? []).map((documento) => ({ nombre, documento })),
    )
    for (const { nombre, documento } of documentos) {
      const todosIguales = [...documento].every((digito) => digito === documento[0])
      expect(todosIguales, `${nombre} tiene un documento con forma de dato real: ${documento}`).toBe(true)
    }
  })

  it('los nombres de la migración se identifican como sintéticos', () => {
    for (const cliente of CLIENTES_SINTETICOS) {
      expect(cliente.nombre).toMatch(/Sintétic/i)
      expect(cliente.correo).toMatch(DOMINIO_RESERVADO)
    }
    const { filas } = analizarCsv(CSV_CLIENTES_SINTETICOS)
    expect(filas).toHaveLength(CLIENTES_SINTETICOS.length)
    for (const fila of filas) {
      expect(fila.celdas[1]).toMatch(/Sintétic/i)
    }
  })

  it('los proveedores de la migración se identifican como sintéticos', () => {
    for (const proveedor of PROVEEDORES_SINTETICOS) {
      expect(proveedor.razon_social).toMatch(/Sintétic/i)
      expect(proveedor.correo).toMatch(DOMINIO_RESERVADO)
      expect(proveedor.cuit).toMatch(/^309/)
    }
    const { filas } = analizarCsv(CSV_PROVEEDORES_SINTETICOS)
    expect(filas).toHaveLength(PROVEEDORES_SINTETICOS.length)
  })
})
