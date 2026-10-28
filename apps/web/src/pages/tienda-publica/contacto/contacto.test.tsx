import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), contenido: vi.fn() }))

vi.mock('../../../lib/tiendaContacto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaContacto')>()),
  leerContactoTienda: mocks.leer,
}))
vi.mock('../../../hooks/useContenidoPublico', () => ({ useContenidoPublico: mocks.contenido }))

import RutaContacto from '../rutas/contacto'

// F-TDA-16 (FR-009, FR-060): migas, título, bloques con datos de LA tienda, bloques sin dato ocultos, 404 de
// subruta y estados de carga / error. Vive fuera de `rutas/` porque esa carpeta se carga con import.meta.glob.

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const contexto = (host: string) => ({ tienda, host, categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } })

const MUNDO_JC = { nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'mundojc377@gmail.com', horarios: 'Lunes a viernes de 10 a 19 h' }
const SAN_JAVUCHO = { nombre: 'San Javucho', whatsapp: '+54 9 11 4000-0000', correo: 'hola@sanjavucho.com', horarios: 'Sábados de 10 a 14 h' }

function montar(entrada = '/contacto', host = 'mundojc.localhost') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<Outlet context={contexto(host)} />}>
          <Route path="/contacto" element={<RutaContacto />} />
          <Route path="/contacto/:contactoId" element={<RutaContacto />} />
          <Route path="/" element={<p>Inicio de la tienda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RutaContacto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contenido.mockReturnValue(null)
    mocks.leer.mockImplementation(async (host: string) => (host === 'sanjavucho.localhost' ? SAN_JAVUCHO : MUNDO_JC))
  })

  it('muestra migas, título «Contacto», los bloques WhatsApp (número y horarios) y Correo, y el formulario', async () => {
    montar()
    expect(await screen.findByRole('heading', { level: 1, name: 'Contacto' })).toBeInTheDocument()
    const migas = screen.getByRole('navigation', { name: 'Migas de pan' })
    expect(within(migas).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(migas).getByText('Contacto')).toHaveAttribute('aria-current', 'page')
    const whatsapp = screen.getByTestId('bloque-whatsapp')
    expect(within(whatsapp).getByText('+54 9 11 7365-2596')).toBeInTheDocument()
    expect(within(whatsapp).getByText('Lunes a viernes de 10 a 19 h')).toBeInTheDocument()
    expect(within(screen.getByTestId('bloque-correo')).getByText('mundojc377@gmail.com')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Escribinos' })).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('cada tienda ve SUS datos (aislamiento entre tiendas)', async () => {
    montar('/contacto', 'sanjavucho.localhost')
    expect(await screen.findByText('hola@sanjavucho.com')).toBeInTheDocument()
    expect(screen.getByText('Sábados de 10 a 14 h')).toBeInTheDocument()
    expect(screen.queryByText('mundojc377@gmail.com')).not.toBeInTheDocument()
  })

  it('la bajada sale del texto de la tienda y, sin texto, no se muestra', async () => {
    mocks.contenido.mockReturnValue({ pie: 'Accesorios y repuestos para consolas.' })
    const { unmount } = montar()
    expect(await screen.findByText('Accesorios y repuestos para consolas.')).toBeInTheDocument()
    unmount()
    mocks.contenido.mockReturnValue({ pie: '   ' })
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Contacto' })
    expect(screen.queryByText('Accesorios y repuestos para consolas.')).not.toBeInTheDocument()
  })

  it('sin correo ni horarios: el bloque o la línea que falta no se muestra', async () => {
    mocks.leer.mockResolvedValue({ nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: null, horarios: null })
    montar()
    await screen.findByTestId('bloque-whatsapp')
    expect(screen.queryByTestId('bloque-correo')).not.toBeInTheDocument()
    expect(screen.queryByText(/lunes/i)).not.toBeInTheDocument()
  })

  it('sin WhatsApp ni correo: no hay bloques de datos, solo el formulario', async () => {
    mocks.leer.mockResolvedValue({ nombre: 'Mundo JC', whatsapp: null, correo: null, horarios: 'Lunes a viernes' })
    montar()
    await screen.findByRole('heading', { name: 'Escribinos' })
    expect(screen.queryByTestId('datos-contacto')).not.toBeInTheDocument()
    expect(screen.queryByText('Lunes a viernes')).not.toBeInTheDocument()
  })

  it('/contacto/<algo> muestra la 404 amable', async () => {
    montar('/contacto/algo')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Escribinos' })).not.toBeInTheDocument()
  })

  it('host sin contacto (null) muestra la 404 amable', async () => {
    mocks.leer.mockResolvedValue(null)
    montar()
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('muestra el estado de carga del kit mientras llegan los datos', () => {
    mocks.leer.mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('un error de lectura muestra el error con «Reintentar»', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('caído'))
    montar()
    const alerta = await screen.findByTestId('error-con-reintento')
    expect(alerta).toHaveTextContent('No pudimos cargar los datos de contacto.')
    screen.getByRole('button', { name: 'Reintentar' }).click()
    expect(await screen.findByRole('heading', { name: 'Escribinos' })).toBeInTheDocument()
    consola.mockRestore()
  })
})
