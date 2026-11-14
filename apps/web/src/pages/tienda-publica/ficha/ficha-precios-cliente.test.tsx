import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn(), precios: vi.fn() }))

vi.mock('../../../lib/tiendaFicha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaFicha')>()),
  leerFichaProducto: mocks.leer,
}))
vi.mock('../../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
vi.mock('../../../lib/tiendaPreciosCliente', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaPreciosCliente')>()),
  leerPreciosCliente: mocks.precios,
}))

import RutaProducto from '../rutas/producto'

// F-CLI-07 (FR-031, FR-032, FR-035, SC-007): la ficha según la sesión — visitante, minorista y mayorista —
// y el cambio de tipo / suspensión entre cargas.
const ID = 'a1000000-0000-4000-8000-000000000001'
const contexto = {
  tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' },
  host: 'mundojc.localhost',
  categorias: { fase: 'lista', categorias: [], reintentar: () => undefined },
}

const MINORISTA = { tipo: 'minorista', escalas: [{ escala: 'x1', desde: 1, hasta: 4, final: 1210 }] }
const MAYORISTA = {
  tipo: 'mayorista',
  escalas: [
    { escala: 'x1', desde: 1, hasta: 4, final: 1210 },
    { escala: 'x5', desde: 5, hasta: 9, final: 1089 },
    { escala: 'x10', desde: 10, hasta: 49, final: 968 },
    { escala: 'x50', desde: 50, hasta: null, final: 847 },
  ],
}

function montar() {
  return render(
    <MemoryRouter initialEntries={[`/producto/${ID}`]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/producto/:productoId" element={<RutaProducto />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leer.mockResolvedValue({
    id: ID, nombre: 'Joystick Pro', descripcion: null, sku: 'PC-1', categoria: null, precio: 1210,
    disponible: true, compatibilidad: null, imagenes: [],
  })
  mocks.firmar.mockResolvedValue({})
  mocks.precios.mockResolvedValue(null)
})

describe('Ficha · precios según el tipo de cliente', () => {
  it('visitante: precio público de siempre, sin bloque de precios del cliente', async () => {
    montar()
    expect(await screen.findByText('$ 1.210')).toBeInTheDocument()
    await waitFor(() => expect(mocks.precios).toHaveBeenCalledWith('mundojc.localhost', ID))
    expect(screen.queryByTestId('precios-cliente')).not.toBeInTheDocument()
  })

  it('minorista activo: ve su precio x1', async () => {
    mocks.precios.mockResolvedValue(MINORISTA)
    const { container } = montar()
    const bloque = await screen.findByTestId('precios-cliente')
    expect(within(bloque).getByRole('heading', { name: 'Tu precio' })).toBeInTheDocument()
    expect(within(bloque).getByText('$ 1.210')).toBeInTheDocument()
    expect(within(bloque).queryByText(/x5/)).not.toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('mayorista activo: ve x1, x5, x10 y x50 con su rango de unidades', async () => {
    mocks.precios.mockResolvedValue(MAYORISTA)
    const { container } = montar()
    const bloque = await screen.findByTestId('precios-cliente')
    expect(within(bloque).getByRole('heading', { name: 'Tus precios por cantidad' })).toBeInTheDocument()
    for (const [rotulo, monto] of [
      ['x1 · 1 a 4 u.', '$ 1.210'],
      ['x5 · 5 a 9 u.', '$ 1.089'],
      ['x10 · 10 a 49 u.', '$ 968'],
      ['x50 · 50 u. o más', '$ 847'],
    ]) {
      const termino = within(bloque).getByText(rotulo)
      expect(termino.nextElementSibling).toHaveTextContent(monto)
    }
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('mayorista con una promoción vigente (MSF-932): la escala que baja muestra el precio promocional y el de la escala tachado', async () => {
    mocks.precios.mockResolvedValue({
      tipo: 'mayorista',
      escalas: [
        { escala: 'x1', desde: 1, hasta: 4, final: 1000, precioAnterior: 1210 },
        { escala: 'x5', desde: 5, hasta: 9, final: 1000, precioAnterior: 1089 },
        { escala: 'x10', desde: 10, hasta: 49, final: 968, precioAnterior: null },
        { escala: 'x50', desde: 50, hasta: null, final: 847 },
      ],
    })
    const { container } = montar()
    const bloque = await screen.findByTestId('precios-cliente')
    const x1 = within(bloque).getByText('x1 · 1 a 4 u.').nextElementSibling as HTMLElement
    expect(within(x1).getByText('$ 1.000', { exact: false })).toBeInTheDocument()
    expect(within(x1).getByTestId('precio-anterior')).toHaveTextContent('$ 1.210')
    expect(within(x1).getByText(/Precio anterior/)).toBeInTheDocument()
    const x5 = within(bloque).getByText('x5 · 5 a 9 u.').nextElementSibling as HTMLElement
    expect(within(x5).getByTestId('precio-anterior')).toHaveTextContent('$ 1.089')
    // Las escalas sin promoción (x10, x50) quedan como siempre: sin tachado.
    expect(within(bloque).getByText('x10 · 10 a 49 u.').nextElementSibling).toHaveTextContent('$ 968')
    expect(within(bloque).getByText('x10 · 10 a 49 u.').nextElementSibling?.querySelector('del')).toBeNull()
    expect(within(bloque).getByText('x50 · 50 u. o más').nextElementSibling?.querySelector('del')).toBeNull()
    expect(within(bloque).getAllByTestId('precio-anterior')).toHaveLength(2)
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('un precio anterior que no es mayor que el final no se tacha (promoción que no baja)', async () => {
    mocks.precios.mockResolvedValue({ tipo: 'minorista', escalas: [{ escala: 'x1', desde: 1, hasta: 4, final: 1210, precioAnterior: 1210 }] })
    montar()
    const bloque = await screen.findByTestId('precios-cliente')
    expect(within(bloque).queryByTestId('precio-anterior')).not.toBeInTheDocument()
    expect(within(bloque).getByText('$ 1.210')).toBeInTheDocument()
  })

  it('cada carga pide de nuevo: tras suspender la cuenta la próxima carga muestra el precio público', async () => {
    mocks.precios.mockResolvedValue(MAYORISTA)
    const primera = montar()
    expect(await screen.findByTestId('precios-cliente')).toBeInTheDocument()
    primera.unmount()

    mocks.precios.mockResolvedValue(null) // cuenta suspendida
    montar()
    expect(await screen.findByText('$ 1.210')).toBeInTheDocument()
    await waitFor(() => expect(mocks.precios).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('precios-cliente')).not.toBeInTheDocument()
  })

  it('cambio de tipo entre cargas: de mayorista a minorista ya no muestra las escalas', async () => {
    mocks.precios.mockResolvedValue(MAYORISTA)
    const primera = montar()
    expect(await screen.findByText('x5 · 5 a 9 u.')).toBeInTheDocument()
    primera.unmount()

    mocks.precios.mockResolvedValue(MINORISTA)
    montar()
    expect(await screen.findByRole('heading', { name: 'Tu precio' })).toBeInTheDocument()
    expect(screen.queryByText('x5 · 5 a 9 u.')).not.toBeInTheDocument()
  })
})
