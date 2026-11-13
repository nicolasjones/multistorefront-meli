import { render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), buscar: vi.fn(), firmar: vi.fn() }))

vi.mock('../../lib/tiendaListado', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaListado')>()),
  leerPaginaCatalogo: mocks.leer,
}))
vi.mock('../../lib/tiendaBusqueda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaBusqueda')>()),
  leerPaginaBusqueda: mocks.buscar,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import ListadoProductos from './secciones-catalogo/ListadoProductos'
import { celular } from '../../test/matchMedia'

// MSF-846 (hallazgo QA 1): las tarjetas usan h3; el listado antepone un h2 oculto visualmente para que axe no reporte
// «heading-order» (h1 → h3) en celular (390 px); en escritorio (1440 px) el orden ya lo cubren los h2 del panel de filtros, así que ese caso es de caracterización. Fuera de `secciones-catalogo/` (glob).

const CAT_A = 'ca000000-0000-4000-8000-00000000000a'
const pagina = {
  total: 2, pagina: 1, tamano: 24,
  categorias: [{ id: CAT_A, nombre: 'Joysticks', padreId: null, productos: 2 }],
  productos: [
    { id: 'p-1', nombre: 'Joystick', precio: 100, disponible: true, imagen: null, categoriaId: CAT_A, destacado: false },
    { id: 'p-2', nombre: 'Cargador', precio: 50, disponible: true, imagen: null, categoriaId: CAT_A, destacado: false },
  ],
}

function montar(entrada: string, categoriaId: string | null = null) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route
          path="*"
          element={<main><h1>Página</h1><ListadoProductos tienda={{ tiendaId: 't', empresaNombre: 'Mundo JC', estado: 'publicada' }} host="mundojc.localhost" categoriaId={categoriaId} /></main>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

async function erroresDeOrden(contenedor: HTMLElement) {
  const r = await axe.run(contenedor, { runOnly: { type: 'rule', values: ['heading-order'] } })
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leer.mockResolvedValue(pagina)
  mocks.buscar.mockResolvedValue(pagina)
  mocks.firmar.mockResolvedValue({})
})
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

describe.each([[true, '390 px (celular)'], [false, '1440 px (escritorio)']])('orden de encabezados del listado en %s', (esCelular, _etiqueta) => {
  it.each([
    ['/catalogo', null, 'Productos'],
    ['/catalogo?q=joystick', null, 'Resultados'],
    [`/categoria/${CAT_A}`, CAT_A, 'Productos'],
  ])('%s: h2 «%s» antes de las tarjetas y sin violaciones de heading-order', async (url, categoriaId, titulo) => {
    celular(esCelular)
    const { container } = montar(url, categoriaId)
    await screen.findAllByTestId('tarjeta-producto')
    const h2 = screen.getAllByRole('heading', { level: 2, name: titulo })
    expect(h2).toHaveLength(1)
    expect(h2[0].compareDocumentPosition(screen.getAllByRole('heading', { level: 3 })[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await erroresDeOrden(container)).toEqual([])
  })
})
