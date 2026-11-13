import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TABLAS_SOLO_LECTURA, analizar, revisarE2e } from './verificar-e2e-sin-escritura-directa.mjs'

test('detecta el INSERT directo por el helper de siembra (mutación: con el literal falla)', () => {
  assert.equal(analizar("await rest('consultas', { origen: 'formulario' }, 'dominio')").length, 1)
  assert.equal(analizar("const [c] = await rest<{ id: string }>('consultas', cuerpo, 'dominio')").length, 1)
})

test('sin el literal pasa: la RPC de negocio y las tablas de lectura no se marcan', () => {
  assert.deepEqual(analizar("const r = await fetch(`${url}/rest/v1/rpc/crear_consulta_publica`, { method: 'POST' })"), [])
  assert.deepEqual(analizar("await rest('consultas_bandeja', cuerpo)"), [])
  assert.deepEqual(analizar("await rest('productos', cuerpo, 'dominio')"), [])
})

test('detecta la baja directa y la llamada partida en dos renglones', () => {
  assert.equal(analizar("await borrar(`movimientos_stock?organizacion_id=eq.${id}`, 'dominio')").length, 1)
  assert.equal(analizar("await borrar('consultas', `empresa_id=eq.${e}`)").length, 1)
  assert.equal(analizar("await rest(\n  'consultas',\n  [{ a: 1 }],\n  'dominio',\n)").length, 1)
})

test('detecta fetch con método de escritura a la ruta REST de cada tabla', () => {
  for (const tabla of TABLAS_SOLO_LECTURA) {
    const codigo = `const r = await fetch(\`\${url}/rest/v1/${tabla}?id=eq.1\`, {\n  method: 'DELETE',\n  headers: h,\n})`
    assert.equal(analizar(codigo).length, 1, tabla)
  }
})

test('leer es válido: GET y leer(...) no se marcan', () => {
  assert.deepEqual(analizar("const r = await fetch(`${url}/rest/v1/consultas?select=id`, { headers: h })"), [])
  assert.deepEqual(analizar("await leer<{ id: string }>(`movimientos_stock?producto_id=eq.${id}&select=id`, 'dominio')"), [])
})

test('se exime con un comentario que lleva motivo, y no sin motivo', () => {
  assert.deepEqual(analizar("// escritura-directa: ok — prueba del permiso denegado\nawait rest('consultas', cuerpo)"), [])
  assert.deepEqual(analizar("await rest('consultas', cuerpo) // escritura-directa: ok — fixture del 403"), [])
  assert.equal(analizar("// escritura-directa: ok\nawait rest('consultas', cuerpo)").length, 1)
})

test('los comentarios no cuentan', () => {
  assert.deepEqual(analizar("// await rest('consultas', cuerpo)"), [])
})

test('apps/web/e2e no tiene escrituras directas', () => {
  assert.deepEqual(revisarE2e(), [])
})
