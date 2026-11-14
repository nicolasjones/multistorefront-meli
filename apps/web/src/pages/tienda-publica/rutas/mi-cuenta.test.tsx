import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  schema: vi.fn(),
  firmar: vi.fn(),
  leerCapacidadesTienda: vi.fn(),
  sesionActivaEnTienda: vi.fn(),
  salirCliente: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { schema: mocks.schema, auth: { onAuthStateChange: mocks.onAuthStateChange } } }))
vi.mock('../../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
vi.mock('../../../lib/tiendaCapacidades', () => ({ leerCapacidadesTienda: mocks.leerCapacidadesTienda }))
vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  sesionActivaEnTienda: mocks.sesionActivaEnTienda,
  salirCliente: mocks.salirCliente,
}))

import RutaMiCuenta from './mi-cuenta'

const HOST = 'mundojc.localhost'
const ID_1 = 'c1000000-0000-4000-8000-000000000001'
const P_1 = 'a1000000-0000-4000-8000-000000000001'
const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: HOST, categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

const COMPRAS = {
  estado: 'ok', total: 1, siguiente: null,
  filas: [{ id: ID_1, numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', total_con_iva: 85000 }],
}
const FAVORITOS = {
  estado: 'ok', total: 1, siguiente: null,
  filas: [{ producto_id: P_1, nombre: 'Joystick Pro', sku: 'JOY-1', imagen: null, disponible: true, precio_final: 2500, escala: 'x1' }],
}
const DETALLE = {
  estado: 'ok', numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', valido_hasta: null,
  total_sin_iva: 100, iva: 21, total_con_iva: 121, lineas: [{ descripcion: 'Cable USB', codigo: 'CAB-1', cantidad: 1, precio_unitario: 100, subtotal: 100 }],
}

type Respuesta = Record<string, unknown> | ((argumentos: Record<string, unknown>) => unknown)
function rpcs(respuestas: Record<string, Respuesta>) {
  mocks.rpc.mockImplementation(async (funcion: string, argumentos: Record<string, unknown>) => {
    const respuesta = respuestas[funcion]
    return { data: typeof respuesta === 'function' ? (respuesta as (a: Record<string, unknown>) => unknown)(argumentos) : respuesta ?? null, error: null }
  })
}

function Ubicacion() {
  const ubicacion = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
      <button type="button" onClick={() => navigate(-1)}>Atrás (prueba)</button>
    </>
  )
}

function montar(entrada = '/mi-cuenta') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<><Outlet context={contexto} /><Ubicacion /></>}>
          <Route path="/mi-cuenta" element={<RutaMiCuenta />} />
          <Route path="/mi-cuenta/:mi-cuentaId" element={<RutaMiCuenta />} />
          <Route path="/ingresar" element={<p>Pantalla de ingreso</p>} />
          <Route path="/contacto" element={<p>Pantalla de contacto</p>} />
          <Route path="/" element={<p>Inicio de la tienda</p>} />
          <Route path="*" element={<p data-testid="pagina-no-encontrada">404</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fijarAncho(1440)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  mocks.firmar.mockResolvedValue({})
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  mocks.salirCliente.mockResolvedValue(undefined)
  mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
  mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
  rpcs({ mis_compras_por_dominio: COMPRAS, mis_favoritos_por_dominio: FAVORITOS, mi_compra_por_dominio: DETALLE })
})

// F-CLI-20 (FR-001, FR-002, FR-011, FR-014; escenarios A-6, A-7, A-11).
describe('/mi-cuenta (P-3)', () => {
  it('con cuenta activa: h1 «Mi cuenta» con el foco, subtítulo con la tienda y las dos pestañas; arranca en compras', async () => {
    montar()
    const titulo = await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })
    await waitFor(() => expect(titulo).toHaveFocus())
    expect(screen.getByText('Tus compras y presupuestos en Mundo JC')).toBeInTheDocument()
    const pestanas = screen.getByRole('tablist', { name: 'Secciones de Mi cuenta' })
    expect(within(pestanas).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Compras y presupuestos', 'Favoritos'])
    expect(within(pestanas).getByRole('tab', { name: 'Compras y presupuestos' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Nº 00000012')).toBeInTheDocument()
    // La otra pestaña no se pidió todavía.
    expect(mocks.rpc).not.toHaveBeenCalledWith('mis_favoritos_por_dominio', expect.anything())
  })

  it('las pestañas viajan en ?seccion= y conservan la otra cargada', async () => {
    montar()
    await screen.findByText('Nº 00000012')
    fireEvent.click(screen.getByRole('tab', { name: 'Favoritos' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/mi-cuenta?seccion=favoritos')
    expect(await screen.findByRole('link', { name: 'Joystick Pro' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Compras y presupuestos' }))
    expect(screen.getByText('Nº 00000012')).toBeVisible()
    expect(mocks.rpc.mock.calls.filter(([f]) => f === 'mis_compras_por_dominio')).toHaveLength(1)
  })

  it('abrir con ?seccion=favoritos arranca en esa pestaña', async () => {
    montar('/mi-cuenta?seccion=favoritos')
    expect(await screen.findByRole('link', { name: 'Joystick Pro' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Favoritos' })).toHaveAttribute('aria-selected', 'true')
  })

  it('las pestañas se operan con flechas', async () => {
    montar()
    await screen.findByText('Nº 00000012')
    const compras = screen.getByRole('tab', { name: 'Compras y presupuestos' })
    compras.focus()
    fireEvent.keyDown(compras, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Favoritos' })).toHaveFocus()
  })

  it('?compra=<id> abre el detalle y «Cerrar» vuelve a la lista', async () => {
    montar(`/mi-cuenta?seccion=compras&compra=${ID_1}`)
    const dialogo = await screen.findByRole('dialog', { name: /Presupuesto Nº 00000012/ })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/mi-cuenta?seccion=compras')
  })

  it('sin sesión redirige a /ingresar con la ruta y la pestaña de vuelta, sin pedir ningún dato (A-6)', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    montar('/mi-cuenta?seccion=favoritos')
    expect(await screen.findByText('Pantalla de ingreso')).toBeInTheDocument()
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(`/ingresar?volver=${encodeURIComponent('/mi-cuenta?seccion=favoritos')}`)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('con una cuenta no activa (la sesión se da por no iniciada) hace lo mismo: no revela el motivo', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    montar()
    expect(await screen.findByText('Pantalla de ingreso')).toBeInTheDocument()
    expect(screen.queryByText(/suspendid|no está activa/i)).not.toBeInTheDocument()
  })

  it('con la función apagada es la 404 de la tienda y no pide nada (A-11)', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    montar()
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  // FR-014 / A-11: sin la función encendida, un anónimo NO va a «Ingresar» (no se revela que la función existe).
  it('un anónimo con la función apagada ve la 404 y no va a «Ingresar»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    montar()
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByText('Pantalla de ingreso')).not.toBeInTheDocument()
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/mi-cuenta')
  })

  it('un anónimo con las capacidades todavía pendientes ve la carga: no redirige hasta saber que la función está encendida', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    mocks.leerCapacidadesTienda.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(await screen.findByRole('status', { name: 'Cargando tu cuenta' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.sesionActivaEnTienda).toHaveBeenCalled())
    await new Promise((resolver) => setTimeout(resolver, 20))
    expect(screen.queryByText('Pantalla de ingreso')).not.toBeInTheDocument()
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/mi-cuenta')
  })

  it('un anónimo con un error al leer las capacidades ve el error con reintento y no se lo manda a «Ingresar»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    mocks.leerCapacidadesTienda.mockRejectedValue(new Error('red'))
    montar()
    expect(await screen.findByText('No pudimos cargar esta página.')).toBeInTheDocument()
    expect(screen.queryByText('Pantalla de ingreso')).not.toBeInTheDocument()
  })

  // «Atrás» tras cerrar el detalle no lo vuelve a abrir.
  it('abierto desde la lista, «Cerrar» vuelve a la entrada anterior y «atrás» no reabre el detalle', async () => {
    montar()
    fireEvent.click(await screen.findByRole('link', { name: /Ver el detalle de presupuesto Nº 00000012/ }))
    const dialogo = await screen.findByRole('dialog', { name: /Presupuesto Nº 00000012/ })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/mi-cuenta')
    expect(screen.getByTestId('ubicacion')).not.toHaveTextContent('compra=')
    fireEvent.click(screen.getByRole('button', { name: 'Atrás (prueba)' }))
    await new Promise((resolver) => setTimeout(resolver, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('abierto por un enlace directo, «Cerrar» reemplaza la entrada y «atrás» no reabre el detalle', async () => {
    montar(`/mi-cuenta?seccion=compras&compra=${ID_1}`)
    const dialogo = await screen.findByRole('dialog', { name: /Presupuesto Nº 00000012/ })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Atrás (prueba)' }))
    await new Promise((resolver) => setTimeout(resolver, 20))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un sin_acceso al quitar un favorito reemplaza todo por «Tu cuenta no está activa en esta tienda»', async () => {
    rpcs({ mis_compras_por_dominio: COMPRAS, mis_favoritos_por_dominio: FAVORITOS, cambiar_favorito_por_dominio: { estado: 'sin_acceso' } })
    montar('/mi-cuenta?seccion=favoritos')
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar Joystick Pro de favoritos' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tu cuenta no está activa en esta tienda' })).toBeInTheDocument()
    expect(screen.queryByText('Joystick Pro')).not.toBeInTheDocument()
  })

  it('`/mi-cuenta/<algo>` no existe', async () => {
    montar('/mi-cuenta/algo')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('mientras resuelve la función y la sesión muestra la carga, sin contenido ni redirección', async () => {
    mocks.sesionActivaEnTienda.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(await screen.findByRole('status', { name: 'Cargando tu cuenta' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mi cuenta' })).not.toBeInTheDocument()
  })

  it('si no se puede verificar la sesión ofrece reintentar en vez de quedarse cargando', async () => {
    mocks.sesionActivaEnTienda.mockRejectedValueOnce(new Error('red'))
    montar()
    expect(await screen.findByText('No pudimos verificar tu acceso.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument()
  })

  it('la cuenta suspendida a mitad de la sesión: el primer sin_acceso reemplaza todo por el aviso, sin datos previos (A-7)', async () => {
    rpcs({ mis_compras_por_dominio: COMPRAS, mis_favoritos_por_dominio: { estado: 'sin_acceso' } })
    montar()
    await screen.findByText('Nº 00000012')
    fireEvent.click(screen.getByRole('tab', { name: 'Favoritos' }))
    const aviso = await screen.findByRole('heading', { level: 1, name: 'Tu cuenta no está activa en esta tienda' })
    expect(within(aviso.closest('[role="alert"]') as HTMLElement).getByText('Si creés que es un error, escribinos desde Contacto.')).toBeInTheDocument()
    expect(screen.queryByText('Nº 00000012')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Contacto' })).toHaveAttribute('href', '/contacto')
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.salirCliente).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Inicio de la tienda')).toBeInTheDocument()
  })

  it('en celular y tableta «Salir» está en la página (el encabezado ya no lo trae)', async () => {
    fijarAncho(320)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.salirCliente).toHaveBeenCalledTimes(1))
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    fijarAncho(ancho)
    const { container } = montar()
    await screen.findByText(/Nº 00000012/)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
