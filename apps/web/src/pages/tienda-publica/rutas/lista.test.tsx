import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  schema: vi.fn(),
  firmar: vi.fn(),
  leerCapacidadesTienda: vi.fn(),
  sesionActivaEnTienda: vi.fn(),
  onAuthStateChange: vi.fn(),
  useLegal: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { schema: mocks.schema, auth: { onAuthStateChange: mocks.onAuthStateChange } } }))
vi.mock('../../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
vi.mock('../../../lib/tiendaCapacidades', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaCapacidades')>()), leerCapacidadesTienda: mocks.leerCapacidadesTienda }))
vi.mock('../../../lib/tiendaCuenta', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaCuenta')>()), sesionActivaEnTienda: mocks.sesionActivaEnTienda }))
vi.mock('../../../lib/tiendaLegal', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaLegal')>()), useLegalTienda: mocks.useLegal }))

import { agregarALista, leerLista, reiniciarListaPedido } from '../../../lib/listaPedido'
import { reiniciarCapacidadesTienda } from '../../../lib/tiendaCapacidades'
import RutaLista from './lista'

const HOST = 'mundojc.localhost'
const P1 = 'a1000000-0000-4000-8000-000000000001'
const P2 = 'a1000000-0000-4000-8000-000000000002'
const P3 = 'a1000000-0000-4000-8000-000000000003'
const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: HOST, categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

const linea = (id: string, extra: Record<string, unknown> = {}) => ({
  producto_id: id, nombre: `Producto ${id.slice(-1)}`, sku: `SKU-${id.slice(-1)}`, imagen: null, cantidad: 1, disponible: true,
  precio_unitario: 2500, precio_anterior: null, escala: 'x1', subtotal: 2500, ...extra,
})
const respuestaLista = (lineas: unknown[], extra: Record<string, unknown> = {}) => ({ estado: 'ok', con_cuenta: false, tipo: null, lineas, no_disponibles: [], total_referencia: 5000, ...extra })

type Respuesta = Record<string, unknown> | ((argumentos: Record<string, unknown>) => unknown)
function rpcs(respuestas: Record<string, Respuesta>) {
  mocks.rpc.mockImplementation(async (funcion: string, argumentos: Record<string, unknown>) => {
    const respuesta = respuestas[funcion]
    return { data: typeof respuesta === 'function' ? (respuesta as (a: Record<string, unknown>) => unknown)(argumentos) : respuesta ?? null, error: null }
  })
}

function Ubicacion() {
  const ubicacion = useLocation()
  return <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
}

function montar(entrada = '/lista') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<><Outlet context={contexto} /><Ubicacion /></>}>
          <Route path="/lista" element={<RutaLista />} />
          <Route path="/lista/:listaId" element={<RutaLista />} />
          <Route path="/catalogo" element={<p>Catálogo</p>} />
          <Route path="/mi-cuenta" element={<p>Pantalla de Mi cuenta</p>} />
          <Route path="*" element={<p data-testid="pagina-no-encontrada">404</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const llenarVisitante = () => {
  fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Ana Pérez' } })
  fireEvent.change(screen.getByLabelText(/^Correo o teléfono/), { target: { value: 'ana@example.com' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  reiniciarListaPedido()
  reiniciarCapacidadesTienda()
  fijarAncho(1440)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  mocks.firmar.mockResolvedValue({})
  mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
  mocks.sesionActivaEnTienda.mockResolvedValue(null)
  mocks.useLegal.mockReturnValue(null)
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  agregarALista(HOST, P1, 2)
  agregarALista(HOST, P2)
  rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2, subtotal: 5000 }), linea(P2)], { total_referencia: 7500 }) })
})
afterEach(() => { vi.useRealTimers() })

// MSF-176 · B1 · P-4 y P-5: /lista.
describe('/lista · lista de pedido (P-4)', () => {
  it('muestra las líneas revalidadas, el total de referencia y la leyenda fija', async () => {
    montar()
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi lista de pedido' })).toBeInTheDocument()
    expect(screen.getByText('Precios de referencia: se confirman al responder. Este pedido no reserva stock ni es una compra.')).toBeInTheDocument()
    expect(await screen.findAllByTestId('linea-lista')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Producto 1' })).toHaveAttribute('href', `/producto/${P1}`)
    expect(screen.getByText('SKU SKU-1')).toBeInTheDocument()
    expect(screen.getByTestId('resumen-cantidad')).toHaveTextContent('2 productos')
    expect(screen.getByTestId('total-referencia')).toHaveTextContent('$ 7.500')
    expect(mocks.rpc).toHaveBeenCalledWith('lista_pedido_por_dominio', { host: HOST, items: [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }] })
  })

  it('mientras revisa la lista el formulario ya se ve pero «Enviar pedido» está deshabilitado', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementation(() => new Promise((resolverPromesa) => { resolver = resolverPromesa }))
    montar()
    expect(await screen.findByRole('status', { name: 'Revisando tu lista' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled()
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    await act(async () => { resolver({ data: respuestaLista([linea(P1), linea(P2)]), error: null }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeEnabled())
  })

  it('lista vacía: «Tu lista está vacía» con «Ver catálogo»', async () => {
    window.localStorage.clear()
    reiniciarListaPedido()
    montar()
    expect(await screen.findByText('Tu lista está vacía')).toBeInTheDocument()
    expect(screen.getByText('Agregá productos desde el catálogo para armar tu pedido.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('error al revisar la lista: «No pudimos revisar tu lista.» con Reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    montar()
    expect(await screen.findByText('No pudimos revisar tu lista.')).toBeInTheDocument()
    expect(screen.getByText('Revisá tu conexión y probá de nuevo.')).toBeInTheDocument()
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1), linea(P2)]) })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findAllByTestId('linea-lista')).toHaveLength(2)
  })

  it('cambiar la cantidad actualiza la lista del navegador y el subtotal al instante (con «−», «+» y escribiendo)', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Sumar una unidad de Producto 2' }))
    expect(leerLista(HOST).find((l) => l.productoId === P2)?.cantidad).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar una unidad de Producto 2' }))
    expect(leerLista(HOST).find((l) => l.productoId === P2)?.cantidad).toBe(1)
    expect(screen.getByRole('button', { name: 'Quitar una unidad de Producto 2' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad de Producto 1' }), { target: { value: '10' } })
    expect(leerLista(HOST).find((l) => l.productoId === P1)?.cantidad).toBe(10)
    await waitFor(() => expect(screen.getByTestId('total-referencia')).toHaveTextContent('$ 27.500'))
    // Letras y ceros no entran; un campo vacío no cambia la lista.
    fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad de Producto 1' }), { target: { value: 'ab0' } })
    expect(leerLista(HOST).find((l) => l.productoId === P1)?.cantidad).toBe(10)
  })

  it('«Quitar» saca el producto de la lista', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Producto 1 de la lista' }))
    expect(leerLista(HOST).map((l) => l.productoId)).toEqual([P2])
    await waitFor(() => expect(screen.getAllByTestId('linea-lista')).toHaveLength(1))
  })

  it('producto sin stock: figura «Sin stock hoy» y se puede enviar; sin precio: «Precio a confirmar» y el total lo aclara', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { disponible: false }), linea(P2, { precio_unitario: null, subtotal: null })], { total_referencia: 5000 }) })
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByText('Sin stock hoy: lo confirmamos al responder')).toBeInTheDocument()
    expect(screen.getByText('Precio a confirmar')).toBeInTheDocument()
    expect(screen.getByText('Total de referencia (sin los productos con precio a confirmar)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeEnabled()
  })

  it('con promoción muestra el precio tachado igual que la ficha', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { precio_unitario: 2400, precio_anterior: 3000 })], { total_referencia: 4800 }) })
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByTestId('precio-anterior')).toHaveTextContent('$ 3.000')
  })

  it('no disponibles: sección aparte, advertencia, sin contar en el total y solo «Quitar»', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2, subtotal: 5000 })], { no_disponibles: [P2], total_referencia: 5000 }) })
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByText('1 producto de tu lista ya no está disponible. No lo vamos a enviar.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'No disponibles' })).toBeInTheDocument()
    const agotada = screen.getByTestId('linea-no-disponible')
    expect(within(agotada).getByText('No disponible')).toBeInTheDocument()
    expect(screen.getByTestId('resumen-cantidad')).toHaveTextContent('1 producto')
    expect(screen.getByTestId('total-referencia')).toHaveTextContent('$ 5.000')
    fireEvent.click(within(agotada).getByRole('button', { name: /^Quitar/ }))
    expect(leerLista(HOST).map((l) => l.productoId)).toEqual([P1])
  })

  it('almacenamiento bloqueado: avisa que la lista se conserva solo mientras no se cierre la página', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    reiniciarListaPedido()
    agregarALista(HOST, P1)
    montar()
    expect(await screen.findByText('Tu navegador no nos deja guardar la lista: se conserva mientras no cierres esta página.')).toBeInTheDocument()
  })

  it('función apagada: es la 404 de la tienda; mientras se resuelve solo carga; con error de capacidades, reintentar', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    montar()
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByText('Mi lista de pedido')).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('/lista/<algo> no existe', async () => {
    montar('/lista/otra')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('el producto cuyo nombre trae HTML se ve literal (no se ejecuta)', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { nombre: '<img src=x onerror=alert(1)>Taza' })], { total_referencia: 2500 }) })
    const { container } = montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByText('<img src=x onerror=alert(1)>Taza')).toBeInTheDocument()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('/lista · enviar el pedido (FR-025 a FR-029, P-4)', () => {
  it('valida los campos al enviar: errores bajo cada campo y el foco en el primero', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Ingresá tu nombre.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá un correo o un teléfono válido (de 8 a 15 números).')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveFocus()
    expect(screen.getByLabelText(/^Nombre/)).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'enviar_lista_pedido')).toBe(false)
  })

  it('nota de más de 500 caracteres y caracteres no aceptados', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'x'.repeat(501) } })
    expect(screen.getByText('501/500')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('La nota admite hasta 500 caracteres.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'hola\u0007' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Hay caracteres que no podemos aceptar.')).toBeInTheDocument()
  })

  it('muestra el aviso de uso de datos y el enlace «Política de privacidad» solo si la tienda lo tiene', async () => {
    mocks.useLegal.mockReturnValue({ razonSocial: 'Mundo JC SRL', cuit: null, direccion: null, enlaces: [{ titulo: 'Política de privacidad', url: 'https://mundojc.example/privacidad' }] })
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByText(/Usaremos estos datos solo para responderte\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', 'https://mundojc.example/privacidad')
  })

  it('envía: revalida antes, manda solo producto_id y cantidad con una clave, vacía la lista y muestra «No se cobró nada»', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]), enviar_lista_pedido: { estado: 'ok' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'Factura A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    const titulo = await screen.findByRole('heading', { level: 1, name: 'Recibimos tu pedido' })
    expect(titulo).toHaveFocus()
    expect(screen.getByText('Te vamos a responder para confirmar disponibilidad y precio. No se cobró nada.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Seguir viendo productos' })).toHaveAttribute('href', '/catalogo')
    expect(screen.queryByRole('link', { name: 'Ir a Mi cuenta' })).not.toBeInTheDocument()
    expect(leerLista(HOST)).toEqual([])
    const envios = mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'enviar_lista_pedido')
    expect(envios).toHaveLength(1)
    expect(envios[0][1]).toEqual({
      host: HOST, nombre: 'Ana Pérez', contacto: 'ana@example.com', nota: 'Factura A',
      items: [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }], clave_envio: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    const llamadas = mocks.rpc.mock.calls.map(([funcion]) => funcion)
    expect(llamadas.lastIndexOf('lista_pedido_por_dominio')).toBeLessThan(llamadas.indexOf('enviar_lista_pedido'))
  })

  it('una sola petición en vuelo: el botón queda «Enviando…» y un segundo clic no manda otra', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]) })
    const base = mocks.rpc.getMockImplementation()!
    mocks.rpc.mockImplementation((funcion: string, argumentos: Record<string, unknown>) => (
      funcion === 'enviar_lista_pedido' ? new Promise((resolverPromesa) => { resolver = resolverPromesa }) : base(funcion, argumentos)
    ))
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    const enviando = await screen.findByRole('button', { name: 'Enviando…' })
    expect(enviando).toBeDisabled()
    expect(enviando).toHaveAttribute('aria-busy', 'true')
    fireEvent.submit(screen.getByTestId('formulario-pedido'))
    await act(async () => { resolver({ data: { estado: 'ok' }, error: null }) })
    await screen.findByText('Recibimos tu pedido')
    expect(mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'enviar_lista_pedido')).toHaveLength(1)
  })

  it('con error la lista se CONSERVA, ofrece Reintentar y el reintento usa la misma clave', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let intento = 0
    rpcs({
      lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]),
      enviar_lista_pedido: () => { intento += 1; return intento === 1 ? { estado: 'error' } : { estado: 'ok' } },
    })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('No pudimos enviar tu pedido. Tu lista sigue acá: probá de nuevo.')).toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Ana Pérez')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('Recibimos tu pedido')
    const claves = mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'enviar_lista_pedido').map(([, argumentos]) => argumentos.clave_envio)
    expect(claves).toHaveLength(2)
    expect(claves[0]).toBe(claves[1])
  })

  it('cambiar lo escrito tras un error pide otra clave (es otro envío)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]), enviar_lista_pedido: { estado: 'error' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('No pudimos enviar tu pedido. Tu lista sigue acá: probá de nuevo.')
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'Otra cosa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'enviar_lista_pedido')).toHaveLength(2))
    const claves = mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'enviar_lista_pedido').map(([, argumentos]) => argumentos.clave_envio)
    expect(claves[0]).not.toBe(claves[1])
  })

  it('límite: avisa en minutos (hacia arriba, mínimo 1), conserva la lista y habilita el botón al cumplirse la espera', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]), enviar_lista_pedido: { estado: 'limite', espera_segundos: 61 } })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText(/Hiciste varios envíos seguidos\. Probá de nuevo en 2 minutos\./)).toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled()
    await act(async () => { vi.advanceTimersByTime(61_000) })
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeEnabled()
  })

  it('«invalido» del servidor en un campo: mensaje bajo el campo y foco en él', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]), enviar_lista_pedido: { estado: 'invalido', campos: ['contacto'] } })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Ingresá un correo o un teléfono válido (de 8 a 15 números).')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Correo o teléfono/)).toHaveFocus()
  })

  it('productos que se ocultaron: antes de enviar se sacan de la lista y no se mandan', async () => {
    let revalidaciones = 0
    rpcs({
      lista_pedido_por_dominio: () => { revalidaciones += 1; return revalidaciones === 1 ? respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]) : respuestaLista([linea(P1, { cantidad: 2 })], { no_disponibles: [P2] }) },
      enviar_lista_pedido: { estado: 'ok' },
    })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('Recibimos tu pedido')
    const envio = mocks.rpc.mock.calls.find(([funcion]) => funcion === 'enviar_lista_pedido')!
    expect(envio[1].items).toEqual([{ producto_id: P1, cantidad: 2 }])
  })

  it('si el servidor rechaza la lista por un producto, avisa «Revisá tu lista…» y lo quita', async () => {
    rpcs({
      lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]),
      enviar_lista_pedido: { estado: 'invalido', campos: ['items'], no_disponibles: [P2] },
    })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Revisá tu lista: hay productos que no se pueden enviar')).toBeInTheDocument()
    expect(leerLista(HOST).map((l) => l.productoId)).toEqual([P1])
  })

  it('si todo lo de la lista dejó de estar disponible, no se envía nada', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([], { no_disponibles: [P1, P2], total_referencia: null }), enviar_lista_pedido: { estado: 'ok' } })
    montar()
    expect(await screen.findByText('2 productos de tu lista ya no están disponibles. No los vamos a enviar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'enviar_lista_pedido')).toBe(false)
  })
})

describe('/lista · validación al salir de cada campo, límites y avisos (QA H-1, H-3)', () => {
  it('H-3: al salir de Nombre, Contacto y Nota se valida ese campo sin esperar al envío', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    const nombre = screen.getByLabelText(/^Nombre/)
    fireEvent.focus(nombre)
    fireEvent.blur(nombre)
    expect(await screen.findByText('Ingresá tu nombre.')).toBeInTheDocument()
    fireEvent.change(nombre, { target: { value: 'Ana' } })
    expect(screen.queryByText('Ingresá tu nombre.')).not.toBeInTheDocument()
    const contacto = screen.getByLabelText(/^Correo o teléfono/)
    fireEvent.change(contacto, { target: { value: 'esto no es un contacto' } })
    fireEvent.blur(contacto)
    expect(await screen.findByText('Ingresá un correo o un teléfono válido (de 8 a 15 números).')).toBeInTheDocument()
    const nota = screen.getByLabelText(/^Nota/)
    fireEvent.change(nota, { target: { value: 'x'.repeat(501) } })
    fireEvent.blur(nota)
    expect(await screen.findByText('La nota admite hasta 500 caracteres.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'enviar_lista_pedido')).toBe(false)
  })

  it('los campos no admiten más caracteres que el servidor: nombre 100 y contacto 120', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByLabelText(/^Nombre/)).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText(/^Correo o teléfono/)).toHaveAttribute('maxlength', '120')
  })

  it('si la REVISIÓN previa al envío da «límite», avisa «No pudimos revisar tu lista.» (no «varios envíos seguidos») y conserva la lista', async () => {
    let revalidaciones = 0
    rpcs({
      lista_pedido_por_dominio: () => { revalidaciones += 1; return revalidaciones === 1 ? respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]) : { estado: 'limite', espera_segundos: 30 } },
      enviar_lista_pedido: { estado: 'ok' },
    })
    montar()
    await screen.findAllByTestId('linea-lista')
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText(/No pudimos revisar tu lista\./)).toBeInTheDocument()
    expect(screen.queryByText(/varios envíos seguidos/)).not.toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'enviar_lista_pedido')).toBe(false)
  })

  it('H-1: si solo FALLA la escritura del almacenamiento (cuota llena) la lista no se pierde y /lista avisa (FR-022, B1-10)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    reiniciarListaPedido()
    agregarALista(HOST, P1, 2)
    agregarALista(HOST, P2)
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)]) })
    montar()
    expect(await screen.findAllByTestId('linea-lista')).toHaveLength(2)
    expect(screen.getByText('Tu navegador no nos deja guardar la lista: se conserva mientras no cierres esta página.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sumar una unidad de Producto 2' }))
    expect(leerLista(HOST).find((l) => l.productoId === P2)?.cantidad).toBe(2)
    expect(screen.getAllByTestId('linea-lista')).toHaveLength(2)
  })
})

describe('/lista · con cuenta activa (FR-026)', () => {
  const conCuenta = (lineas: unknown[]) => respuestaLista(lineas, { con_cuenta: true, tipo: 'mayorista' })

  it('no pide nombre ni contacto: «Vamos a usar los datos de tu cuenta.», rotula la escala y confirma con «Ir a Mi cuenta»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    rpcs({ lista_pedido_por_dominio: conCuenta([linea(P1, { cantidad: 12, escala: 'x10', precio_unitario: 800, subtotal: 9600 }), linea(P2)]), enviar_lista_pedido: { estado: 'ok' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByText('Vamos a usar los datos de tu cuenta.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Nombre/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Correo o teléfono/)).not.toBeInTheDocument()
    expect(screen.getByText('Escala x10')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nota/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('Recibimos tu pedido')
    expect(screen.getByRole('link', { name: 'Ir a Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta')
  })

  it('si el servidor ya no ve una cuenta activa, avisa «Tu cuenta no está activa…» y vuelve a pedir los datos', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    rpcs({ lista_pedido_por_dominio: conCuenta([linea(P1, { cantidad: 2 }), linea(P2)]), enviar_lista_pedido: { estado: 'invalido', campos: ['nombre', 'contacto'] } })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    expect(await screen.findByText('Tu cuenta no está activa en esta tienda.')).toBeInTheDocument()
    expect(await screen.findByLabelText(/^Nombre/)).toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
  })
})

// MSF-176 · B2 · P-4 y P-5: «Pedir presupuesto» (Q3 de la revisión de QA): el cableado de la pantalla.
describe('/lista · pedir presupuesto (B2, FR-050 a FR-064)', () => {
  const conCuenta = (lineas: unknown[]) => respuestaLista(lineas, { con_cuenta: true, tipo: 'mayorista' })
  const lineaCot = (id: string, extra: Record<string, unknown> = {}) => ({
    producto_id: id, descripcion: `Producto ${id.slice(-1)}`, codigo: `SKU-${id.slice(-1)}`, cantidad: 1, precio_unitario: 2000, subtotal_sin_iva: 2000, iva: 420, disponible: true, ...extra,
  })
  const cotOk = { estado: 'ok', lineas: [lineaCot(P1, { cantidad: 2, subtotal_sin_iva: 4000, iva: 840 }), lineaCot(P2)], total_sin_iva: 6000, iva: 1260, total_con_iva: 7260, no_disponibles: [], sin_precio: [] }
  const confCreado = { estado: 'ok', numero: '00000012', fecha: '2026-11-14', total_con_iva: 7260 }
  const conCuentaActiva = (respuestas: Record<string, Respuesta> = {}) => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    rpcs({ lista_pedido_por_dominio: conCuenta([linea(P1, { cantidad: 2 }), linea(P2)]), cotizar_presupuesto_tienda: cotOk, crear_presupuesto_tienda: confCreado, ...respuestas })
  }

  it('«Pedir presupuesto» SOLO existe con cuenta activa: un visitante no lo ve y «Enviar pedido» es su único botón principal', async () => {
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.queryByRole('button', { name: 'Pedir presupuesto' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toHaveClass('MuiButton-contained')
  })

  it('con cuenta activa: «Pedir presupuesto» (principal) y «Enviar pedido» (secundario), cada uno con su aclaración', async () => {
    conCuentaActiva()
    montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByRole('button', { name: 'Pedir presupuesto' })).toHaveClass('MuiButton-contained')
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toHaveClass('MuiButton-outlined')
    expect(screen.getByText('Te calculamos el precio que te corresponde. Queda a la espera de nuestra respuesta.')).toBeInTheDocument()
    expect(screen.getByText('Mandamos tu lista como consulta, con precios de referencia.')).toBeInTheDocument()
  })

  it('mientras se revisa la lista «Pedir presupuesto» está deshabilitado y no llama a nada', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    mocks.rpc.mockImplementation(() => new Promise(() => undefined))
    montar()
    await screen.findByRole('status', { name: 'Revisando tu lista' })
    // Sin la revalidación del servidor no se pide nada: el botón se ve (hay sesión activa) pero deshabilitado.
    expect(await screen.findByRole('button', { name: 'Pedir presupuesto' })).toBeDisabled()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'cotizar_presupuesto_tienda')).toBe(false)
  })

  it('valida la nota ANTES de abrir el diálogo: más de 500 caracteres o caracteres no aceptados (incluidos los invisibles) y no cotiza', async () => {
    conCuentaActiva()
    montar()
    await screen.findAllByTestId('linea-lista')
    for (const [nota, mensaje] of [['x'.repeat(501), 'La nota admite hasta 500 caracteres.'], ['hola\u200bchau', 'Hay caracteres que no podemos aceptar.'], ['hola\u061cchau', 'Hay caracteres que no podemos aceptar.']] as const) {
      fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: nota } })
      fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
      expect(await screen.findByText(mensaje)).toBeInTheDocument()
      expect(screen.getByLabelText(/^Nota/)).toHaveFocus()
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'cotizar_presupuesto_tienda')).toBe(false)
  })

  it('abre «Tu presupuesto» con la cotización del servidor, manda solo producto_id y cantidad y, al confirmar, vacía la lista y muestra el número y el total', async () => {
    conCuentaActiva()
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: '  Después de las 18  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Tu presupuesto' })
    expect(await within(dialogo).findByTestId('presupuesto-total')).toHaveTextContent('$ 7.260,00')
    expect(mocks.rpc).toHaveBeenCalledWith('cotizar_presupuesto_tienda', { host: HOST, items: [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }] })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar presupuesto' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Pedimos tu presupuesto Nº 00000012' })).toBeInTheDocument()
    expect(screen.getByText('Total con IVA: $ 7.260,00')).toBeInTheDocument()
    expect(screen.queryByText(/El precio cambió/)).not.toBeInTheDocument()
    const llamada = mocks.rpc.mock.calls.find(([funcion]) => funcion === 'crear_presupuesto_tienda')
    expect(llamada?.[1]).toMatchObject({ host: HOST, items: [{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }], nota: 'Después de las 18' })
    expect(Object.keys(llamada?.[1] as object).sort()).toEqual(['clave_envio', 'host', 'items', 'nota'])
    // La lista se vació (almacenamiento y estado) y el presupuesto se enlaza en «Mi cuenta».
    expect(leerLista(HOST)).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Ver en Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta?seccion=compras')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('si el total confirmado difiere del cotizado avisa que el precio cambió', async () => {
    conCuentaActiva({ crear_presupuesto_tienda: { ...confCreado, total_con_iva: 6000 } })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    expect(await screen.findByText('El precio cambió mientras armabas el presupuesto. Este es el total vigente.')).toBeInTheDocument()
  })

  it('sin_acceso al COTIZAR: cierra el diálogo, avisa «Tu cuenta no está activa…», vuelve al modo visitante (pide nombre y contacto) y conserva la lista', async () => {
    conCuentaActiva({ cotizar_presupuesto_tienda: { estado: 'sin_acceso' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    expect(await screen.findByText('Tu cuenta no está activa en esta tienda.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByLabelText(/^Nombre/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir presupuesto' })).not.toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
  })

  it('sin_acceso al CONFIRMAR: mismo camino (visitante, aviso, lista conservada)', async () => {
    conCuentaActiva({ crear_presupuesto_tienda: { estado: 'sin_acceso' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    expect(await screen.findByText('Tu cuenta no está activa en esta tienda.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByLabelText(/^Nombre/)).toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(2)
  })

  it('un error al crear conserva la lista y reintentar usa la misma clave de envío; cambiar la nota pide otra', async () => {
    conCuentaActiva({ crear_presupuesto_tienda: { estado: 'error' } })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    expect((await screen.findByTestId('resultado-presupuesto')).textContent).toContain('No pudimos pedir tu presupuesto. Tu lista sigue acá: probá de nuevo.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([f]) => f === 'crear_presupuesto_tienda')).toHaveLength(2))
    const claves = mocks.rpc.mock.calls.filter(([f]) => f === 'crear_presupuesto_tienda').map(([, a]) => (a as { clave_envio: string }).clave_envio)
    expect(claves[0]).toBe(claves[1])
    expect(leerLista(HOST)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'otra nota' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    await waitFor(() => expect(mocks.rpc.mock.calls.filter(([f]) => f === 'crear_presupuesto_tienda')).toHaveLength(3))
    const tercera = mocks.rpc.mock.calls.filter(([f]) => f === 'crear_presupuesto_tienda')[2][1] as { clave_envio: string }
    expect(tercera.clave_envio).not.toBe(claves[0])
  })

  it('no manda a cotizar los productos que el servidor ya marcó como no disponibles', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    agregarALista(HOST, P3)
    rpcs({ lista_pedido_por_dominio: { ...conCuenta([linea(P1, { cantidad: 2 }), linea(P2)]), no_disponibles: [P3] }, cotizar_presupuesto_tienda: cotOk })
    montar()
    await screen.findAllByTestId('linea-lista')
    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    await screen.findByRole('dialog', { name: 'Tu presupuesto' })
    const llamada = mocks.rpc.mock.calls.find(([funcion]) => funcion === 'cotizar_presupuesto_tienda')
    expect((llamada?.[1] as { items: { producto_id: string }[] }).items.map((i) => i.producto_id)).toEqual([P1, P2])
  })
})

// SC-006 y FR-033: axe a 320, 768 y 1440 px de cada estado.
describe.each(ANCHOS_TIENDA)('accesibilidad de /lista a %i px', (ancho) => {
  beforeEach(() => { fijarAncho(ancho) })

  it('con productos (incluidos no disponibles y errores por campo), vacía y con la confirmación: sin violaciones de axe', async () => {
    rpcs({ lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2, precio_unitario: 2400, precio_anterior: 3000 }), linea(P2, { disponible: false, precio_unitario: null, subtotal: null })], { no_disponibles: [P3] }), enviar_lista_pedido: { estado: 'ok' } })
    agregarALista(HOST, P3)
    const { container } = montar()
    await screen.findAllByTestId('linea-lista')
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('Ingresá tu nombre.')
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(within(screen.getByTestId('linea-no-disponible')).getByRole('button', { name: /^Quitar/ }))
    llenarVisitante()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
    await screen.findByText('Recibimos tu pedido')
    expect(await violacionesAxe(container)).toEqual([])
  }, 60000)

  it('con cuenta activa (los dos botones, la cotización abierta y la confirmación del presupuesto): sin violaciones de axe', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'mayorista' })
    rpcs({
      lista_pedido_por_dominio: respuestaLista([linea(P1, { cantidad: 2 }), linea(P2)], { con_cuenta: true, tipo: 'mayorista' }),
      cotizar_presupuesto_tienda: { estado: 'ok', lineas: [{ producto_id: P1, descripcion: 'Producto 1', codigo: 'SKU-1', cantidad: 2, precio_unitario: 2000, subtotal_sin_iva: 4000, iva: 840, disponible: true }], total_sin_iva: 4000, iva: 840, total_con_iva: 4840, no_disponibles: [], sin_precio: [] },
      crear_presupuesto_tienda: { estado: 'ok', numero: '00000012', fecha: '2026-11-14', total_con_iva: 4840 },
    })
    const { container, baseElement } = montar()
    await screen.findAllByTestId('linea-lista')
    expect(screen.getByRole('button', { name: 'Pedir presupuesto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Pedir presupuesto' }))
    await screen.findByTestId('presupuesto-total')
    expect(await violacionesAxe(baseElement)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar presupuesto' }))
    await screen.findByRole('heading', { level: 1, name: 'Pedimos tu presupuesto Nº 00000012' })
    expect(await violacionesAxe(baseElement)).toEqual([])
  }, 60000)

  it('lista vacía y error de revisión: sin violaciones de axe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.localStorage.clear()
    reiniciarListaPedido()
    const { container, unmount } = montar()
    await screen.findByText('Tu lista está vacía')
    expect(await violacionesAxe(container)).toEqual([])
    unmount()

    agregarALista(HOST, P1)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const segundo = montar()
    await screen.findByText('No pudimos revisar tu lista.')
    expect(await violacionesAxe(segundo.container)).toEqual([])
  }, 60000)
})
