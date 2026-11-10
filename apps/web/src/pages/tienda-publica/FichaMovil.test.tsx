import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn(), rpc: vi.fn() }))

vi.mock('../../lib/tiendaFicha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaFicha')>()),
  leerFichaProducto: mocks.leer,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
// El cliente de Supabase shared: la ficha lee el contacto de la tienda (F-TDA-14).
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { schema: () => ({ rpc: mocks.rpc }) },
}))

import RutaProducto from './rutas/producto'
import { celular } from '../../test/matchMedia'

// F-TDA-17 (SC-007, FR-042): ficha en una columna con el enlace «← Todos los productos» arriba,
// miniaturas táctiles y ampliación a pantalla completa en celular. Con `matchMedia` en modo celular.
// Vive fuera de `rutas/` porque esa carpeta se carga con import.meta.glob.

const contexto = {
  tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' },
  host: 'mundojc.localhost',
  categorias: { fase: 'lista', categorias: [], reintentar: () => undefined },
}
const ID = 'a1000000-0000-4000-8000-000000000001'

const ficha = {
  id: ID, nombre: 'Joystick Pro', descripcion: 'Inalámbrico', sku: 'PC-1', categoria: { id: 'ca-1', nombre: 'Joysticks' },
  precio: 18455, disponible: true, compatibilidad: 'PS4, PS5',
  imagenes: [{ posicion: 1, ruta: 'a.png' }, { posicion: 2, ruta: 'b.png' }],
}

function montar() {
  return render(
    <MemoryRouter initialEntries={[`/producto/${ID}`]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/producto/:productoId" element={<RutaProducto />} />
          <Route path="/catalogo" element={<p>Pantalla de catálogo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  celular(true)
  mocks.leer.mockResolvedValue(ficha)
  mocks.firmar.mockResolvedValue({ 'a.png': 'https://firmada/a.png', 'b.png': 'https://firmada/b.png' })
  mocks.rpc.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596' }, error: null })
})
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

describe('Ficha móvil (FR-042)', () => {
  it('pone el enlace «← Todos los productos» arriba y lleva al catálogo', async () => {
    montar()
    const enlace = await screen.findByRole('link', { name: '← Todos los productos' })
    expect(enlace).toHaveAttribute('href', '/catalogo')
    // Va antes que el título de la ficha.
    const titulo = screen.getByRole('heading', { level: 1, name: 'Joystick Pro' })
    expect(enlace.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(enlace)
    expect(await screen.findByText('Pantalla de catálogo')).toBeInTheDocument()
  })

  it('muestra precio, disponibilidad, datos y compatibilidad legibles', async () => {
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })
    expect(screen.getByText('PC-1')).toBeInTheDocument()
    expect(screen.getByTestId('compatibilidad')).toHaveTextContent('PS4, PS5')
  })

  it('las miniaturas son botones táctiles que cambian la imagen y la ampliación ocupa la pantalla', async () => {
    montar()
    const miniaturas = await screen.findAllByTestId('miniatura')
    expect(miniaturas).toHaveLength(2)
    fireEvent.click(miniaturas[1])
    expect(miniaturas[1]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Imagen ampliada de Joystick Pro' })
    expect(dialogo.closest('.MuiDialog-root')?.querySelector('.MuiDialog-paperFullScreen')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar imagen ampliada' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('incluye el botón «Consultar por WhatsApp» de la ficha (F-TDA-14, FR-020)', async () => {
    montar()
    expect(await screen.findByRole('button', { name: 'Consultar por WhatsApp' })).toBeInTheDocument()
  })

  it('sin número de WhatsApp la ficha móvil se ve sin botón ni hueco', async () => {
    mocks.rpc.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: null }, error: null })
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('contacto_por_dominio', { host: 'mundojc.localhost' }))
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = montar()
    await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
