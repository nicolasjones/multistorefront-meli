import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analizar, revisarUI } from './verificar-ui-empresas.mjs'

const PANTALLA = 'apps/web/src/pages/ejemplo/list.tsx'

test('detecta un Chip usado como filtro de empresa', () => {
  const hallazgos = analizar('<Chip label="Todas las tiendas" clickable aria-pressed={false} onClick={() => {}} />', PANTALLA)
  assert.equal(hallazgos.length, 1)
  assert.match(hallazgos[0].motivo, /FiltroEmpresa/)
})

test('no marca un Chip de estado que no elige empresas', () => {
  assert.deepEqual(analizar('<Chip label="Inactivos" clickable aria-pressed={false} onClick={() => {}} />', PANTALLA), [])
})

test('detecta un Chip clickable para elegir una empresa', () => {
  const hallazgos = analizar('<Chip label={empresa.nombre} clickable onClick={() => elegir(empresa.id)} />', PANTALLA)
  assert.equal(hallazgos.length, 1)
  assert.match(hallazgos[0].motivo, /SelectorEmpresas/)
})

test('detecta filtros de tienda hechos con TextField o Autocomplete', () => {
  assert.match(analizar('<TextField select label="Tienda" value={id} />', PANTALLA)[0].motivo, /TextField/)
  assert.match(analizar('<Autocomplete renderInput={(params) => <TextField {...params} label="Tienda" />} />', PANTALLA)[0].motivo, /TextField/)
  assert.equal(analizar('<Autocomplete renderInput={(params) => <TextField {...params} label="Empresa" />} />', PANTALLA).length, 0)
})

test('detecta una pantalla que usa el hook de filtro sin el componente compartido', () => {
  const contenido = "const { empresas, valor, cambiar } = useFiltroPorEmpresaActiva()\n<Chip label={empresas[0].nombre} />"
  const hallazgos = analizar(contenido, PANTALLA)
  assert.equal(hallazgos.length, 1)
  assert.match(hallazgos[0].motivo, /FiltroEmpresa/)
})

test('no marca una pantalla que sólo lee la empresa activa ni una que usa FiltroEmpresa', () => {
  assert.deepEqual(analizar('const { empresaActivaId } = useFiltroPorEmpresaActiva()', PANTALLA), [])
  assert.deepEqual(analizar('const { empresas, valor, cambiar } = useFiltroPorEmpresaActiva()\n<FiltroEmpresa empresas={empresas} valor={valor} onCambiar={cambiar} />', PANTALLA), [])
})

test('los tests y las declaraciones quedan exentos', () => {
  assert.deepEqual(analizar('<Chip aria-pressed />', 'apps/web/src/pages/ejemplo/list.test.tsx'), [])
})

test('el repositorio está limpio: todas las empresas usan los componentes compartidos', () => {
  assert.deepEqual(revisarUI(), [])
})
