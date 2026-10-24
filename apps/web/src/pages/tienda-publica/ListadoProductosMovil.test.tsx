import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn() }))

vi.mock('../../lib/tiendaListado', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaListado')>()),
  leerPaginaCatalogo: mocks.leer,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import ListadoProductos from './secciones-catalogo/ListadoProductos'
import { celular } from '../../test/matchMedia'

// F-TDA-17 (FR-041): en celular el catálogo ofrece el botón «Filtrar» y el panel en lugar de la columna
// lateral, con el mismo estado en la URL que escritorio. Vive fuera de `secciones-catalogo/` (glob).

const CAT_A = 'ca000000-0000-4000-8000-00000000000a'
const pagina = {
  total: 2, pagina: 1, tamano: 24,
  categorias: [{ id: CAT_A, nombre: 'Joysticks', padreId: null, productos: 2 }],
  productos: [
    { id: 'p-1', nombre: 'Joystick', precio: 100, disponible: true, imagen: null, categoriaId: CAT_A, destacado: false },
    { id: 'p-2', nombre: 'Cargador', precio: 50, disponible: true, imagen: null, categoriaId: CAT_A, destacado: false },
  ],
}

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <p data-testid="ubicacion">{pathname}{search}</p>
}

function montar(entrada: string, categoriaId: string | null = null) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route
          path="*"
          element={<><ListadoProductos tienda={{ tiendaId: 't', empresaNombre: 'Mundo JC', estado: 'publicada' }} host="mundojc.localhost" categoriaId={categoriaId} /><Ubicacion /></>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  celular(true)
  mocks.leer.mockResolvedValue(pagina)
  mocks.firmar.mockResolvedValue({})
})
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

describe('Catálogo en celular (FR-041)', () => {
  it('reemplaza la columna lateral por «Filtrar» con la cantidad de filtros activos', async () => {
    montar('/catalogo?stock=1&max=500')
    await screen.findAllByTestId('tarjeta-producto')
    expect(screen.queryByRole('complementary', { name: 'Filtros del catálogo' })).not.toBeInTheDocument()
    expect(await screen.findByTestId('filtrar-movil')).toHaveTextContent('2 filtros activos')
  })

  it('el panel cambia la URL como escritorio y «Ver N productos» lo cierra', async () => {
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(await screen.findByTestId('filtrar-movil'))
    const panel = await screen.findByRole('dialog', { name: 'Filtros' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Solo con stock' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/catalogo?stock=1')
    fireEvent.click(within(panel).getByRole('button', { name: 'Limpiar' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/catalogo$/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Ver 2 productos' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('en la ruta de categoría la categoría fija por path no cuenta como filtro', async () => {
    montar(`/categoria/${CAT_A}?stock=1`, CAT_A)
    await screen.findAllByTestId('tarjeta-producto')
    expect(await screen.findByTestId('filtrar-movil')).toHaveTextContent('1 filtro activo')
  })

  it('en escritorio no aparece el botón y sigue la columna lateral', async () => {
    celular(false)
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(screen.queryByTestId('filtrar-movil')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Filtros del catálogo' })).toBeInTheDocument()
  })
})
