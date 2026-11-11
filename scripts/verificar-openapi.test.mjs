// Contrato del guard de OpenAPI (F-API-01, T007, FR-005, SC-004): el publicado
// tiene que ser copia del que viaja con la función, el documento de `api-v1`
// tiene que describir todas las rutas del handler y un cambio incompatible
// exige `BREAKING:` en el commit o en el PR.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cambiosIncompatibles,
  contratosDesalineados,
  rutasSinDocumentar,
  tieneRompimiento,
  versionInvalida,
} from './verificar-openapi.mjs'

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openapi-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const escribir = (ruta, contenido) => {
  const destino = join(dir, ruta)
  mkdirSync(join(destino, '..'), { recursive: true })
  writeFileSync(destino, contenido)
  return destino
}

const documento = (paths) => ({ openapi: '3.1.0', info: { title: 'x', version: 'v1' }, paths })

describe('verificar-openapi', () => {
  it('exige que el publicado sea copia exacta del contrato de la función', () => {
    escribir('supabase/functions/api-v1/openapi.json', '{"a":1}')
    escribir('openapi/api-v1.json', '{"a":1}')
    escribir('supabase/functions/entregar-webhook/openapi.json', '{"b":2}')
    escribir('openapi/entregar-webhook.json', '{"b":3}')
    const desalineados = contratosDesalineados(dir)
    assert.equal(desalineados.length, 1)
    assert.equal(desalineados[0].publicado, 'openapi/entregar-webhook.json')
  })

  it('faltaría el publicado si no existe', () => {
    escribir('supabase/functions/api-v1/openapi.json', '{"a":1}')
    escribir('supabase/functions/entregar-webhook/openapi.json', '{"b":2}')
    const desalineados = contratosDesalineados(dir)
    assert.equal(desalineados.length, 2)
    assert.ok(desalineados.every((d) => d.motivo.startsWith('falta')))
  })

  it('una ruta del handler que el documento no describe queda sin documentar', () => {
    const contrato = documento({ '/v1/productos': {} })
    assert.deepEqual(rutasSinDocumentar(contrato, ['/v1/productos', '/v1/stock']), ['/v1/stock'])
    assert.deepEqual(rutasSinDocumentar(contrato, ['/v1/productos']), [])
  })

  it('el documento tiene que ser OpenAPI 3.1', () => {
    assert.equal(versionInvalida(documento({})), null)
    assert.match(versionInvalida({ openapi: '3.0.3' }), /3\.1/)
  })

  it('un cambio incompatible se detecta: ruta, respuesta y parámetro obligatorio', () => {
    const antes = documento({
      '/v1/productos': { get: { parameters: [{ name: 'cursor', required: false }], responses: { 200: {}, 401: {} } } },
    })
    const despues = documento({
      '/v1/productos': { get: { parameters: [{ name: 'cursor', required: false }, { name: 'marca', required: true }], responses: { 200: {} } } },
    })
    const cambios = cambiosIncompatibles(antes, despues)
    assert.ok(cambios.some((c) => c.includes('401')))
    assert.ok(cambios.some((c) => c.includes('marca')))

    const sinRuta = cambiosIncompatibles(antes, documento({}))
    assert.ok(sinRuta.some((c) => c.includes('/v1/productos')))
  })

  it('un cambio aditivo no rompe el contrato', () => {
    const antes = documento({ '/v1/productos': { get: { responses: { 200: {} } } } })
    const despues = documento({
      '/v1/productos': { get: { responses: { 200: {}, 400: {} } } },
      '/v1/nuevo': { get: { responses: { 200: {} } } },
    })
    assert.deepEqual(cambiosIncompatibles(antes, despues), [])
  })

  it('el rompimiento se avisa con BREAKING:', () => {
    assert.equal(tieneRompimiento('feat(MSF-403): algo\n\nBREAKING: se quita /v1/productos'), true)
    assert.equal(tieneRompimiento('feat(MSF-403): algo'), false)
  })
})
