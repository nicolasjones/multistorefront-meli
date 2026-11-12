// Pruebas del generador de la referencia de la API (F-API-01, MSF-233). Corre con `node --test`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { ESTADO_DEL_CODIGO, REFERENCIA, generarReferencia, leerContrato, referenciaEsperada } from './openapi-a-markdown.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const contrato = leerContrato()
const pagina = generarReferencia(contrato)

describe('referencia de la API generada del contrato', () => {
  it('es determinista', () => {
    assert.equal(generarReferencia(contrato), pagina)
  })

  it('la página versionada coincide con el contrato (pnpm openapi:escribir)', () => {
    assert.equal(readFileSync(join(RAIZ, REFERENCIA), 'utf8'), referenciaEsperada())
  })

  it('documenta cada ruta de lectura con su alcance, su ejemplo de respuesta y su llamada', () => {
    for (const ruta of ['/v1/productos', '/v1/stock', '/v1/precios', '/v1/ventas']) {
      assert.match(pagina, new RegExp(`### \`GET ${ruta}\``), `falta ${ruta}`)
    }
    assert.match(pagina, /Ejemplo de respuesta `200`/)
    assert.match(pagina, /=== "curl"/)
    assert.match(pagina, /Authorization: Bearer \$CLAVE_API/)
  })

  it('el catálogo de errores cubre exactamente los códigos del contrato', () => {
    const delContrato = [...contrato.components.schemas.Error.properties.error.properties.codigo.enum].sort()
    assert.deepEqual(Object.keys(ESTADO_DEL_CODIGO).sort(), delContrato)
    for (const codigo of delContrato) assert.match(pagina, new RegExp(`\\| \`${codigo}\` \\| ${ESTADO_DEL_CODIGO[codigo]} \\|`))
  })

  it('documenta los tres avisos con su firma y sus campos', () => {
    for (const tipo of ['stock.actualizado', 'precio.actualizado', 'venta.registrada']) {
      assert.match(pagina, new RegExp(`### \`${tipo.replace('.', '\\.')}\``))
    }
    assert.match(pagina, /X-Firma/)
    assert.match(pagina, /reintenta hasta 5 veces/)
  })

  it('los ejemplos de objetos traen todos los campos obligatorios de su esquema', () => {
    for (const nombre of ['Producto', 'Stock', 'Precios', 'Venta']) {
      const esquema = contrato.components.schemas[nombre]
      for (const campo of esquema.required) assert.ok(campo in esquema.example, `${nombre}.example sin ${campo}`)
    }
  })

  it('los ejemplos de avisos traen los campos obligatorios de datos', () => {
    const porAviso = { 'stock.actualizado': 'EventoStock', 'precio.actualizado': 'EventoPrecio', 'venta.registrada': 'EventoVenta' }
    for (const [aviso, esquema] of Object.entries(porAviso)) {
      const ejemplo = contrato.webhooks[aviso].post.requestBody.content['application/json'].example
      const requeridos = contrato.components.schemas[esquema].properties.datos.required
      for (const campo of requeridos) assert.ok(campo in ejemplo.datos, `${aviso}: falta ${campo} en el ejemplo`)
      assert.equal(ejemplo.tipo, aviso)
    }
  })
})
