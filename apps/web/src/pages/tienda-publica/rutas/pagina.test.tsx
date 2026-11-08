import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leerPagina: vi.fn(), rpc: vi.fn() }))

// Datos SEO de la tienda (los lee la cabecera compartida de MSF-149).
vi.mock('../../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({ rpc: mocks.rpc }),
    storage: { from: () => ({ getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://cdn.test/${ruta}` } }) }) },
  },
}))

vi.mock('../../../lib/tiendaPaginas', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaPaginas')>()),
  leerPaginaPublica: mocks.leerPagina,
}))

import { limpiarCacheSeo } from '../../../lib/tiendaSeo'
import RutaPagina from './pagina'

const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

function montar(ruta = '/pagina/como-comprar') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/pagina" element={<RutaPagina />} />
          <Route path="/pagina/:paginaId" element={<RutaPagina />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ruta pública /pagina/:slug (FR-006, SC-002)', () => {
  beforeEach(() => {
    limpiarCacheSeo()
    mocks.rpc.mockResolvedValue({ data: { dominio: 'mundojc.test', nombre: 'Mundo JC', descripcion: 'Joysticks y repuestos', logo_ruta: null, indexable: true }, error: null })
    vi.clearAllMocks()
    mocks.leerPagina.mockResolvedValue({ titulo: 'Cómo comprar', slug: 'como-comprar', contenido: 'Paso 1\nsigue\n\nPaso 2' })
  })

  it('muestra migas, título y el texto en párrafos, y pide la página de ESTA tienda', async () => {
    const { container } = montar()

    expect(await screen.findByRole('heading', { level: 1, name: 'Cómo comprar' })).toBeInTheDocument()
    expect(mocks.leerPagina).toHaveBeenCalledWith('mundojc.localhost', 'como-comprar')
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    const parrafos = container.querySelectorAll('[data-testid="pagina-contenido"] p')
    expect(parrafos).toHaveLength(2)
    expect(parrafos[0].textContent).toBe('Paso 1\nsigue')
    expect(await violacionesAxe(container)).toEqual([])
    // Cabecera SEO compartida: plantilla «<página> | <empresa>».
    await waitFor(() => expect(document.title).toBe('Cómo comprar | Mundo JC'))
  })

  it('un texto con HTML se ve literal y no se ejecuta ni se inserta como elemento', async () => {
    mocks.leerPagina.mockResolvedValue({ titulo: 'Envíos', slug: 'envios', contenido: '<script>alert(1)</script><b>hola</b>' })
    const { container } = montar('/pagina/envios')

    expect(await screen.findByText('<script>alert(1)</script><b>hola</b>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('una página inexistente, oculta o ajena muestra la 404 de la tienda', async () => {
    mocks.leerPagina.mockResolvedValue(null)
    montar('/pagina/oculta')

    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('/pagina sin slug muestra la 404 sin pedir nada', async () => {
    montar('/pagina')

    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(mocks.leerPagina).not.toHaveBeenCalled()
  })

  it('una falla de red muestra el error con «Reintentar», que vuelve a pedir', async () => {
    mocks.leerPagina.mockRejectedValueOnce(new Error('sin red'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    montar()

    // FR-004/FR-024: la pantalla de error no se indexa.
    await screen.findByTestId('error-con-reintento')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Cómo comprar' })).toBeInTheDocument()
    expect(mocks.leerPagina).toHaveBeenCalledTimes(2)
  })
})
