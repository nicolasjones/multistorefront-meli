import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn(), firmar: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { schema: mocks.schema } }))
vi.mock('../../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import { DetalleCompra } from './DetalleCompra'
import { FavoritosMiCuenta } from './FavoritosMiCuenta'
import { HistorialMiCuenta } from './HistorialMiCuenta'

const HOST = 'mundojc.localhost'
const ID_1 = 'c1000000-0000-4000-8000-000000000001'
const ID_2 = 'c1000000-0000-4000-8000-000000000002'
const ID_3 = 'c1000000-0000-4000-8000-000000000003'
const P_1 = 'a1000000-0000-4000-8000-000000000001'
const P_2 = 'a1000000-0000-4000-8000-000000000002'

type Respuesta = Record<string, unknown> | ((argumentos: Record<string, unknown>) => unknown)
function rpcs(respuestas: Record<string, Respuesta>) {
  mocks.rpc.mockImplementation(async (funcion: string, argumentos: Record<string, unknown>) => {
    const respuesta = respuestas[funcion]
    return { data: typeof respuesta === 'function' ? (respuesta as (a: Record<string, unknown>) => unknown)(argumentos) : respuesta ?? null, error: null }
  })
}

const compra = (id: string, numero: string, extra: Record<string, unknown> = {}) => ({
  id, numero, fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', total_con_iva: 85000, ...extra,
})
const favorito = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  producto_id: id, nombre, sku: 'SKU-1', imagen: `org/${id}.png`, disponible: true, precio_final: 2500, escala: 'x1', ...extra,
})

function Ubicacion() {
  const ubicacion = useLocation()
  return <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  fijarAncho(1440)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  mocks.firmar.mockResolvedValue({})
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

// IntersectionObserver no existe en jsdom: «Cargar más» es la vía operable (y la que se prueba).
describe('HistorialMiCuenta · Compras y presupuestos (FR-003, FR-004, P-3)', () => {
  const montar = (alSinAcceso = vi.fn()) => render(<MemoryRouter><HistorialMiCuenta host={HOST} alSinAcceso={alSinAcceso} /><Ubicacion /></MemoryRouter>)

  const PAGINA_1 = {
    estado: 'ok', total: 3,
    filas: [
      compra(ID_1, '12'),
      compra(ID_2, '11', { tipo: 'compra', estado_publico: 'confirmada', total_con_iva: 1210.5, fecha: '2026-11-10' }),
    ],
    siguiente: { fecha: '2026-11-10', id: ID_2 },
  }
  const PAGINA_2 = { estado: 'ok', total: 3, filas: [compra(ID_3, '10', { tipo: 'nota_credito', estado_publico: 'nota_credito', total_con_iva: -500, fecha: '2026-11-01' })], siguiente: null }

  it('escritorio: tabla de cinco columnas con fecha, número, tipo, estado público y total con IVA', async () => {
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    montar()
    const tabla = await screen.findByRole('table', { name: 'Compras y presupuestos' })
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Fecha', 'Número', 'Tipo', 'Estado', 'Total con IVA'])
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(within(filas[0]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['12/11/2026', 'Nº 00000012', 'Presupuesto', 'Pendiente', '$ 85.000,00'])
    expect(within(filas[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['10/11/2026', 'Nº 00000011', 'Compra', 'Confirmada', '$ 1.210,50'])
    expect(screen.getByText('3 comprobantes')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('mis_compras_por_dominio', { host: HOST, desde_fecha: null, desde_id: null, limite: 20 })
  })

  it('nunca muestra estados de cobro ni de despacho', async () => {
    rpcs({ mis_compras_por_dominio: { ...PAGINA_1, filas: [compra(ID_1, '1', { tipo: 'compra', estado_publico: 'deuda' }), compra(ID_2, '2', { tipo: 'compra', estado_publico: 'armando' })], total: 2, siguiente: null } })
    montar()
    await screen.findByRole('table')
    expect(screen.queryByText(/deuda|cobrado|armando|en proceso|incompleto/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Confirmada')).toHaveLength(2)
  })

  it('celular y tableta: tarjetas con el estado en texto y toda la tarjeta lleva al detalle', async () => {
    fijarAncho(320)
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    montar()
    const lista = await screen.findByRole('list', { name: 'Compras y presupuestos' })
    const tarjetas = within(lista).getAllByRole('link')
    expect(tarjetas).toHaveLength(2)
    expect(tarjetas[0]).toHaveTextContent('Presupuesto Nº 00000012')
    expect(tarjetas[0]).toHaveTextContent('Pendiente')
    expect(tarjetas[0]).toHaveTextContent('$ 85.000,00')
    fireEvent.click(tarjetas[0])
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(`/mi-cuenta?seccion=compras&compra=${ID_1}`)
  })

  it('escritorio: clic en la fila abre el detalle (?compra=) y el número es un enlace con nombre accesible', async () => {
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    montar()
    const enlace = await screen.findByRole('link', { name: 'Ver el detalle de presupuesto Nº 00000012 del 12/11/2026' })
    fireEvent.click(enlace)
    expect(screen.getByTestId('ubicacion')).toHaveTextContent(`compra=${ID_1}`)
  })

  it('«Cargar más» suma la tanda siguiente con el cursor y al final dice «Llegaste al final de tus compras y presupuestos»', async () => {
    rpcs({ mis_compras_por_dominio: (a) => (a.desde_id ? PAGINA_2 : PAGINA_1) })
    montar()
    await screen.findByRole('table')
    expect(screen.queryByText('Llegaste al final de tus compras y presupuestos')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('Nº 00000010')).toBeInTheDocument()
    expect(screen.getByText('-$ 500,00')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_compras_por_dominio', { host: HOST, desde_fecha: '2026-11-10', desde_id: ID_2, limite: 20 })
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText('Llegaste al final de tus compras y presupuestos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('«Cargar más» es operable con teclado (es un botón enfocable)', async () => {
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    montar()
    await screen.findByRole('table')
    const boton = screen.getByRole('button', { name: 'Cargar más' })
    boton.focus()
    expect(boton).toHaveFocus()
  })

  it('vacío: «Todavía no tenés compras ni presupuestos en esta tienda» con «Ver catálogo»', async () => {
    rpcs({ mis_compras_por_dominio: { estado: 'ok', total: 0, filas: [], siguiente: null } })
    montar()
    expect(await screen.findByText('Todavía no tenés compras ni presupuestos en esta tienda')).toBeInTheDocument()
    expect(screen.getByText('Cuando compres o pidas un presupuesto, lo vas a ver acá.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo')
  })

  it('error con reintento: «No pudimos cargar tus compras.»', async () => {
    rpcs({ mis_compras_por_dominio: { estado: 'error' } })
    montar()
    expect(await screen.findByText('No pudimos cargar tus compras.')).toBeInTheDocument()
    expect(screen.getByText('Revisá tu conexión y probá de nuevo.')).toBeInTheDocument()
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('un error al pedir MÁS filas conserva lo ya cargado y ofrece reintentar', async () => {
    rpcs({ mis_compras_por_dominio: (a) => (a.desde_id ? { estado: 'error' } : PAGINA_1) })
    montar()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('No pudimos cargar más resultados.')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('la cuenta suspendida a mitad de la sesión: el primer sin_acceso avisa a la pantalla y no deja datos', async () => {
    const alSinAcceso = vi.fn()
    rpcs({ mis_compras_por_dominio: (a) => (a.desde_id ? { estado: 'sin_acceso' } : PAGINA_1) })
    montar(alSinAcceso)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Nº 00000012')).not.toBeInTheDocument()
  })

  it('cada tienda muestra lo suyo: cambiar de host descarta el historial anterior y pide el del host nuevo', async () => {
    rpcs({ mis_compras_por_dominio: (a) => (a.host === HOST ? PAGINA_1 : { estado: 'ok', total: 1, filas: [compra(ID_3, '77')], siguiente: null }) })
    const { rerender } = render(<MemoryRouter><HistorialMiCuenta host={HOST} alSinAcceso={vi.fn()} /></MemoryRouter>)
    await screen.findByText('Nº 00000012')
    rerender(<MemoryRouter><HistorialMiCuenta host="sanjavucho.localhost" alSinAcceso={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByText('Nº 00000077')).toBeInTheDocument()
    expect(screen.queryByText('Nº 00000012')).not.toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_compras_por_dominio', expect.objectContaining({ host: 'sanjavucho.localhost' }))
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px (lista, vacío y error)', async (ancho) => {
    fijarAncho(ancho)
    rpcs({ mis_compras_por_dominio: PAGINA_1 })
    const lista = montar()
    await screen.findByText(/Nº 00000012/)
    expect(await violacionesAxe(lista.container)).toEqual([])
    lista.unmount()
    rpcs({ mis_compras_por_dominio: { estado: 'ok', total: 0, filas: [], siguiente: null } })
    const vacio = montar()
    await screen.findByText('Todavía no tenés compras ni presupuestos en esta tienda')
    expect(await violacionesAxe(vacio.container)).toEqual([])
    vacio.unmount()
    rpcs({ mis_compras_por_dominio: { estado: 'error' } })
    const error = montar()
    await screen.findByText('No pudimos cargar tus compras.')
    expect(await violacionesAxe(error.container)).toEqual([])
  })
})

describe('DetalleCompra (FR-005, FR-006, P-3)', () => {
  const DETALLE = {
    estado: 'ok', numero: '12', fecha: '2026-11-12', tipo: 'presupuesto', estado_publico: 'pendiente', valido_hasta: '2026-12-01',
    total_sin_iva: 100, iva: 21, total_con_iva: 121,
    lineas: [{ descripcion: 'Cable USB tipo C', codigo: 'CAB-1', cantidad: 2, precio_unitario: 50, subtotal: 100 }],
  }
  const montar = (alCerrar = vi.fn(), alSinAcceso = vi.fn()) => render(<MemoryRouter><DetalleCompra host={HOST} comprobanteId={ID_1} alCerrar={alCerrar} alSinAcceso={alSinAcceso} /></MemoryRouter>)

  it('escritorio: título con tipo, número y estado; fecha, válido hasta, aviso de presupuesto, líneas y totales', async () => {
    rpcs({ mi_compra_por_dominio: DETALLE })
    montar()
    const dialogo = await screen.findByRole('dialog', { name: /Presupuesto Nº 00000012/ })
    expect(within(dialogo).getByText('Pendiente')).toBeInTheDocument()
    expect(within(dialogo).getByText('12/11/2026')).toBeInTheDocument()
    expect(within(dialogo).getByText('Válido hasta')).toBeInTheDocument()
    expect(within(dialogo).getByText('01/12/2026')).toBeInTheDocument()
    expect(within(dialogo).getByText('Es un presupuesto: no reserva stock ni es una compra.')).toBeInTheDocument()
    const tabla = within(dialogo).getByRole('table', { name: 'Líneas del comprobante' })
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Descripción', 'Código', 'Cantidad', 'Precio unitario', 'Subtotal'])
    expect(within(tabla).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Cable USB tipo C', 'CAB-1', '2', '$ 50,00', '$ 100,00'])
    expect(within(dialogo).getByText('Subtotal sin IVA').nextSibling).toHaveTextContent('$ 100,00')
    expect(within(dialogo).getByText('IVA').nextSibling).toHaveTextContent('$ 21,00')
    expect(within(dialogo).getByText('Total con IVA').nextSibling).toHaveTextContent('$ 121,00')
    expect(mocks.rpc).toHaveBeenCalledWith('mi_compra_por_dominio', { host: HOST, comprobante_id: ID_1 })
  })

  it('celular: una tarjeta por línea con «Cód.», cantidad × precio y subtotal', async () => {
    fijarAncho(320)
    rpcs({ mi_compra_por_dominio: DETALLE })
    montar()
    const lista = await screen.findByRole('list', { name: 'Líneas del comprobante' })
    expect(within(lista).getByText('Cable USB tipo C')).toBeInTheDocument()
    expect(within(lista).getByText('Cód. CAB-1')).toBeInTheDocument()
    expect(within(lista).getByText('2 × $ 50,00')).toBeInTheDocument()
    expect(within(lista).getByText('$ 100,00')).toBeInTheDocument()
  })

  it('una compra no muestra el aviso de presupuesto ni «Válido hasta»', async () => {
    rpcs({ mi_compra_por_dominio: { ...DETALLE, tipo: 'compra', estado_publico: 'confirmada', valido_hasta: null } })
    montar()
    const dialogo = await screen.findByRole('dialog', { name: /Compra Nº 00000012/ })
    expect(within(dialogo).queryByText(/Es un presupuesto/)).not.toBeInTheDocument()
    expect(within(dialogo).queryByText('Válido hasta')).not.toBeInTheDocument()
    expect(within(dialogo).getByText('Confirmada')).toBeInTheDocument()
  })

  it('no muestra costos, márgenes, descuento, operador ni depósito aunque la respuesta los trajera', async () => {
    rpcs({ mi_compra_por_dominio: { ...DETALLE, costo: 40, margen: 0.5, descuento_pct: 10, operador: 'Ana Operadora', deposito: 'Depósito Central', notas: 'nota interna', lineas: [{ ...DETALLE.lineas[0], costo_unitario: 20, descuento_pct: 10 }] } })
    montar()
    const dialogo = await screen.findByRole('dialog')
    await within(dialogo).findByText('Cable USB tipo C')
    expect(dialogo.textContent).not.toMatch(/Ana Operadora|Depósito Central|nota interna|costo|margen|descuento/i)
  })

  it('un comprobante ajeno o inexistente muestra «No encontramos ese comprobante» y «Volver a mis compras» cierra', async () => {
    rpcs({ mi_compra_por_dominio: { estado: 'no_encontrada' } })
    const alCerrar = vi.fn()
    montar(alCerrar)
    expect(await screen.findByText('No encontramos ese comprobante')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a mis compras' }))
    expect(alCerrar).toHaveBeenCalledTimes(1)
  })

  it('error con reintento y sin_acceso avisa a la pantalla', async () => {
    rpcs({ mi_compra_por_dominio: { estado: 'error' } })
    const { unmount } = montar()
    expect(await screen.findByText('No pudimos cargar el comprobante.')).toBeInTheDocument()
    rpcs({ mi_compra_por_dominio: DETALLE })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Cable USB tipo C')).toBeInTheDocument()
    unmount()
    const alSinAcceso = vi.fn()
    rpcs({ mi_compra_por_dominio: { estado: 'sin_acceso' } })
    montar(vi.fn(), alSinAcceso)
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalledTimes(1))
  })

  it('«Cerrar» y Esc cierran el detalle', async () => {
    rpcs({ mi_compra_por_dominio: DETALLE })
    const alCerrar = vi.fn()
    montar(alCerrar)
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    expect(alCerrar).toHaveBeenCalledTimes(2)
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    fijarAncho(ancho)
    rpcs({ mi_compra_por_dominio: DETALLE })
    montar()
    const dialogo = await screen.findByRole('dialog')
    await within(dialogo).findByText('Cable USB tipo C')
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})

describe('FavoritosMiCuenta (FR-008, FR-009, P-3)', () => {
  const montar = (alSinAcceso = vi.fn()) => render(<MemoryRouter><FavoritosMiCuenta host={HOST} alSinAcceso={alSinAcceso} /></MemoryRouter>)
  const PAGINA = { estado: 'ok', total: 2, filas: [favorito(P_1, 'Joystick Pro'), favorito(P_2, 'Cargador rápido', { disponible: false, precio_final: null, imagen: null })], siguiente: null }

  it('lista nombre (enlace a la ficha), disponibilidad, precio según la cuenta o «Precio a confirmar», con contador', async () => {
    mocks.firmar.mockResolvedValue({ [`org/${P_1}.png`]: 'https://firmada/a.png' })
    rpcs({ mis_favoritos_por_dominio: PAGINA })
    montar()
    const lista = await screen.findByRole('list', { name: 'Favoritos' })
    const items = within(lista).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('link', { name: 'Joystick Pro' })).toHaveAttribute('href', `/producto/${P_1}`)
    expect(within(items[0]).getByText('Disponible')).toBeInTheDocument()
    expect(within(items[0]).getByText('$ 2.500')).toBeInTheDocument()
    expect(within(items[0]).getByRole('img', { name: 'Joystick Pro' })).toHaveAttribute('src', 'https://firmada/a.png')
    expect(within(items[1]).getByText('Sin stock')).toBeInTheDocument()
    expect(within(items[1]).getByText('Precio a confirmar')).toBeInTheDocument()
    expect(screen.getByText('2 favoritos')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('mis_favoritos_por_dominio', { host: HOST, desde_creado: null, desde_id: null, limite: 20 })
  })

  it('no dibuja «Agregar a la lista» (la lista de pedido es de otra historia)', async () => {
    rpcs({ mis_favoritos_por_dominio: PAGINA })
    montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    expect(screen.queryByRole('button', { name: /Agregar a la lista/ })).not.toBeInTheDocument()
  })

  it('«Quitar» saca el favorito, baja el contador y «Deshacer» lo vuelve a su lugar', async () => {
    rpcs({ mis_favoritos_por_dominio: PAGINA, cambiar_favorito_por_dominio: (a) => ({ estado: 'ok', favorito: a.favorito }) })
    montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Joystick Pro de favoritos' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Quitamos «Joystick Pro» de tus favoritos')
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_favorito_por_dominio', { host: HOST, producto_id: P_1, favorito: false })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1 favorito')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deshacer' })) })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_favorito_por_dominio', { host: HOST, producto_id: P_1, favorito: true })
    expect(within(screen.getAllByRole('listitem')[0]).getByRole('link', { name: 'Joystick Pro' })).toBeInTheDocument()
    expect(screen.getByText('2 favoritos')).toBeInTheDocument()
  })

  it('quitar el último muestra el vacío', async () => {
    rpcs({ mis_favoritos_por_dominio: { ...PAGINA, total: 1, filas: [PAGINA.filas[0]] }, cambiar_favorito_por_dominio: { estado: 'ok', favorito: false } })
    montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Joystick Pro de favoritos' }))
    expect(await screen.findByText('Todavía no guardaste favoritos')).toBeInTheDocument()
  })

  it('un error al quitar avisa y no saca la tarjeta', async () => {
    rpcs({ mis_favoritos_por_dominio: PAGINA, cambiar_favorito_por_dominio: { estado: 'error' } })
    montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Joystick Pro de favoritos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos quitar el favorito. Probá de nuevo.')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('fin de lista: «Llegaste al final de tus favoritos»; con más, «Cargar más» suma la siguiente tanda', async () => {
    rpcs({
      mis_favoritos_por_dominio: (a) => (a.desde_id
        ? { estado: 'ok', total: 2, filas: [PAGINA.filas[1]], siguiente: null }
        : { estado: 'ok', total: 2, filas: [PAGINA.filas[0]], siguiente: { creado_en: '2026-11-12T10:00:00Z', id: P_1 } }),
    })
    montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    expect(screen.queryByText('Llegaste al final de tus favoritos')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByRole('link', { name: 'Cargador rápido' })).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_favoritos_por_dominio', { host: HOST, desde_creado: '2026-11-12T10:00:00Z', desde_id: P_1, limite: 20 })
    expect(screen.getByText('Llegaste al final de tus favoritos')).toBeInTheDocument()
  })

  it('vacío, error con reintento y sin_acceso', async () => {
    rpcs({ mis_favoritos_por_dominio: { estado: 'ok', total: 0, filas: [], siguiente: null } })
    const vacio = montar()
    expect(await screen.findByText('Todavía no guardaste favoritos')).toBeInTheDocument()
    expect(screen.getByText('Tocá «Guardar en favoritos» en la ficha de un producto para tenerlo a mano.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/catalogo')
    vacio.unmount()

    rpcs({ mis_favoritos_por_dominio: { estado: 'error' } })
    const conError = montar()
    expect(await screen.findByText('No pudimos cargar tus favoritos.')).toBeInTheDocument()
    conError.unmount()

    const alSinAcceso = vi.fn()
    rpcs({ mis_favoritos_por_dominio: { estado: 'sin_acceso' } })
    montar(alSinAcceso)
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalledTimes(1))
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px (lista, vacío y error)', async (ancho) => {
    fijarAncho(ancho)
    rpcs({ mis_favoritos_por_dominio: PAGINA })
    const lista = montar()
    await screen.findByRole('list', { name: 'Favoritos' })
    expect(await violacionesAxe(lista.container)).toEqual([])
    lista.unmount()
    rpcs({ mis_favoritos_por_dominio: { estado: 'ok', total: 0, filas: [], siguiente: null } })
    const vacio = montar()
    await screen.findByText('Todavía no guardaste favoritos')
    expect(await violacionesAxe(vacio.container)).toEqual([])
    vacio.unmount()
    rpcs({ mis_favoritos_por_dominio: { estado: 'error' } })
    const error = montar()
    await screen.findByText('No pudimos cargar tus favoritos.')
    expect(await violacionesAxe(error.container)).toEqual([])
  })
})
