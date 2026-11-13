import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { TABLAS_SOLO_LECTURA, analizar, revisarE2e } from './verificar-e2e-sin-escritura-directa.mjs'

const hallazgos = (codigo) => analizar(codigo).length

test('detecta el INSERT directo por el helper de siembra (mutación: con el literal falla)', () => {
  assert.equal(hallazgos("await rest('consultas', { origen: 'formulario' }, 'dominio')"), 1)
  assert.equal(hallazgos("const [c] = await rest<{ id: string }>('consultas', cuerpo, 'dominio')"), 1)
})

test('sin el literal pasa: la RPC de negocio y las tablas de lectura no se marcan', () => {
  assert.equal(hallazgos("const r = await fetch(`${url}/rest/v1/rpc/crear_consulta_publica`, { method: 'POST' })"), 0)
  assert.equal(hallazgos("await rest('consultas_bandeja', cuerpo)"), 0)
  assert.equal(hallazgos("await rest('productos', cuerpo, 'dominio')"), 0)
})

test('detecta la baja directa, el prefijo dominio. y la llamada partida en dos renglones', () => {
  assert.equal(hallazgos("await borrar(`movimientos_stock?organizacion_id=eq.${id}`, 'dominio')"), 1)
  assert.equal(hallazgos("await borrar('consultas', `empresa_id=eq.${e}`)"), 1)
  assert.equal(hallazgos("await rest('dominio.consultas', cuerpo)"), 1)
  assert.equal(hallazgos("await rest(\n  'consultas',\n  [{ a: 1 }],\n  'dominio',\n)"), 1)
})

test('un helper de escritura con nombre nuevo también se detecta; los de lectura no', () => {
  assert.equal(hallazgos("await sembrarFilas('lotes_stock', filas)"), 1)
  assert.equal(hallazgos("await cargarDatos('historial_cobros', filas)"), 1)
  assert.equal(hallazgos("await leer<{ id: string }>('movimientos_stock?select=id', 'dominio')"), 0)
  assert.equal(hallazgos("await esperarConsultas('consultas?select=id')"), 0)
  assert.equal(hallazgos("await page.goto('consultas')"), 0)
})

test('detecta fetch con método de escritura a la ruta REST de cada tabla, y request.* de Playwright', () => {
  for (const tabla of TABLAS_SOLO_LECTURA) {
    const codigo = `const r = await fetch(\`\${url}/rest/v1/${tabla}?id=eq.1\`, {\n  method: 'DELETE',\n  headers: h,\n})`
    assert.equal(hallazgos(codigo), 1, tabla)
  }
  assert.equal(hallazgos("await request.post(`${url}/rest/v1/consultas`, { data: cuerpo })"), 1)
  assert.equal(hallazgos("await request.delete(`${url}/rest/v1/movimientos_stock?id=eq.1`)"), 1)
  assert.equal(hallazgos("await request.get(`${url}/rest/v1/consultas?select=id`)"), 0)
})

test('detecta SQL directo por pg, con o sin prefijo', () => {
  assert.equal(hallazgos("await cliente.query(\"insert into dominio.consultas (nombre) values ('x')\")"), 1)
  assert.equal(hallazgos("await cliente.query('DELETE FROM movimientos_stock')"), 1)
  assert.equal(hallazgos("await cliente.query('update historial_cobros set a = 1')"), 1)
  assert.equal(hallazgos("await cliente.query('select * from dominio.consultas')"), 0)
})

test('detecta el SQL de pg partido en varios renglones', () => {
  assert.equal(hallazgos("await cliente.query(`insert into\n  dominio.consultas (nombre)\n  values ('x')`)"), 1)
  assert.equal(hallazgos("await cliente.query(`delete\n  from movimientos_stock`)"), 1)
  assert.equal(hallazgos("await cliente.query(`select *\n  from dominio.consultas`)"), 0)
})

test('detecta la URL de la tabla guardada en una variable y usada en una petición de escritura', () => {
  assert.equal(hallazgos("const ruta = `${url}/rest/v1/consultas`\nawait fetch(ruta, { method: 'POST', body })"), 1)
  assert.equal(hallazgos("const ruta = `${url}/rest/v1/movimientos_stock?id=eq.1`\nconst r = await fetch(ruta, {\n  method: 'DELETE',\n})"), 1)
  assert.equal(hallazgos("const ruta = `${url}/rest/v1/consultas`\nawait request.post(ruta, { data })"), 1)
  // La misma variable solo para leer no se marca.
  assert.equal(hallazgos("const ruta = `${url}/rest/v1/consultas?select=id`\nawait fetch(ruta, { headers })"), 0)
  assert.equal(hallazgos("const ruta = `${url}/rest/v1/consultas?select=id`\nawait request.get(ruta)"), 0)
})

test('las evasiones residuales documentadas no se detectan (las atrapa el grant real al correr la suite)', () => {
  assert.equal(hallazgos("const base = `${url}/rest/v1`\nawait fetch(`${base}/consultas`, { method: 'POST' })"), 0)
  assert.equal(hallazgos("await rest('consul' + 'tas', cuerpo)"), 0)
  assert.equal(hallazgos("await borrar(`${tabla}?id=eq.1`)"), 0)
})

test('detecta el nombre de la tabla en una variable o arreglo usado por un helper de escritura', () => {
  assert.equal(hallazgos("const t = 'consultas'\nawait rest(t, cuerpo, 'dominio')"), 1)
  assert.equal(hallazgos("for (const tabla of ['movimientos_stock', 'productos']) {\n  await borrar(tabla, filtro)\n}"), 1)
  // Solo el nombre guardado, sin ningún helper de escritura con variable: es una lectura o un texto.
  assert.equal(hallazgos("const t = 'consultas'\nawait leer(`${t}?select=id`)"), 0)
})

test('leer es válido: GET, leer(...) y .select no se marcan', () => {
  assert.equal(hallazgos("const r = await fetch(`${url}/rest/v1/consultas?select=id`, { headers: h })"), 0)
  assert.equal(hallazgos("await leer<{ id: string }>(`movimientos_stock?producto_id=eq.${id}&select=id`, 'dominio')"), 0)
})

test('falso positivo: un GET a una tabla protegida cerca de un POST a otra no se marca', () => {
  const codigo = [
    'const antes = await fetch(`${url}/rest/v1/consultas?select=id`, { headers: h })',
    'const r = await fetch(`${url}/rest/v1/productos`, {',
    "  method: 'POST',",
    '  body,',
    '})',
  ].join('\n')
  assert.equal(hallazgos(codigo), 0)
  // …pero el POST a la tabla protegida sí.
  assert.equal(hallazgos(codigo.replace('rest/v1/productos', 'rest/v1/consultas')), 1)
})

test('se exime con un comentario que lleva motivo, y no sin motivo', () => {
  assert.equal(hallazgos("// escritura-directa: ok — prueba del permiso denegado\nawait rest('consultas', cuerpo)"), 0)
  assert.equal(hallazgos("await rest('consultas', cuerpo) // escritura-directa: ok — fixture del 403"), 0)
  assert.equal(hallazgos("// escritura-directa: ok\nawait rest('consultas', cuerpo)"), 1)
})

test('los comentarios y los imports no cuentan', () => {
  assert.equal(hallazgos("// await rest('consultas', cuerpo)"), 0)
  assert.equal(hallazgos("import { consultas } from './consultas'"), 0)
})

test('apps/web/e2e no tiene escrituras directas', () => {
  assert.deepEqual(revisarE2e(), [])
})

test('la lista de tablas coincide con la `inalterables` del pgTAP service_role_privilegios', () => {
  const pgtap = readFileSync(fileURLToPath(new URL('../supabase/tests/database/service_role_privilegios.test.sql', import.meta.url)), 'utf8')
  const bloque = pgtap.match(/insert into inalterables values([\s\S]*?);/)
  assert.ok(bloque, 'no se encontró `insert into inalterables values` en el pgTAP: ajustar este test')
  const declaradas = [...bloque[1].matchAll(/\('([a-z_]+)'\)/g)].map((m) => m[1]).sort()
  assert.deepEqual([...TABLAS_SOLO_LECTURA].sort(), declaradas)
})
