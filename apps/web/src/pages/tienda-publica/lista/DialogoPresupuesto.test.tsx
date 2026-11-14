import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ cotizarPresupuesto: vi.fn(), crearPresupuesto: vi.fn() }))
vi.mock('../../../lib/tiendaPedido', async (importar) => ({
  ...(await importar<typeof import('../../../lib/tiendaPedido')>()),
  cotizarPresupuesto: mocks.cotizarPresupuesto,
  crearPresupuesto: mocks.crearPresupuesto,
}))

import { DialogoPresupuesto, LEYENDA_PRESUPUESTO } from './DialogoPresupuesto'

const A = 'a1000000-0000-4000-8000-000000000001'
const B = 'a1000000-0000-4000-8000-000000000002'
const HOST = 'mundojc.localhost'
const LINEAS = [{ productoId: A, cantidad: 12 }, { productoId: B, cantidad: 1 }]
const NOMBRES = new Map([[A, 'Joystick'], [B, 'Auricular']])
const CLAVE = 'b1000000-0000-4000-8000-000000000001'

const cotizacion = (extra: Record<string, unknown> = {}) => ({
  estado: 'ok' as const,
  cotizacion: {
    lineas: [
      { productoId: A, descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 12, precioUnitario: 735, subtotalSinIva: 8820, iva: 1852.2, disponible: true },
      { productoId: B, descripcion: 'Auricular', codigo: null, cantidad: 1, precioUnitario: 2000, subtotalSinIva: 2000, iva: 420, disponible: true },
    ],
    totalSinIva: 10820, iva: 2272.2, totalConIva: 13092.2, noDisponibles: [] as string[], sinPrecio: [] as string[], ...extra,
  },
})

const alCerrar = vi.fn()
const alConfirmado = vi.fn()
const alSinAcceso = vi.fn()
const montar = (nota = '') =>
  render(<DialogoPresupuesto host={HOST} lineas={LINEAS} nota={nota} claveEnvio={CLAVE} nombres={NOMBRES} alCerrar={alCerrar} alConfirmado={alConfirmado} alSinAcceso={alSinAcceso} />)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  fijarAncho(1440)
  mocks.cotizarPresupuesto.mockResolvedValue(cotizacion())
})

// MSF-176 · B2 · P-4 (FR-050, FR-062, FR-064).
describe('DialogoPresupuesto', () => {
  it('cotiza al abrir con la lista y muestra líneas, totales con centavos y la leyenda del presupuesto', async () => {
    montar()
    expect(screen.getByRole('status', { name: 'Calculando tu presupuesto' })).toBeInTheDocument()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(mocks.cotizarPresupuesto).toHaveBeenCalledWith(HOST, LINEAS)
    expect(screen.getByRole('heading', { name: 'Tu presupuesto' })).toBeInTheDocument()
    expect(screen.getByTestId('presupuesto-subtotal')).toHaveTextContent('$ 10.820,00')
    expect(screen.getByTestId('presupuesto-iva')).toHaveTextContent('$ 2.272,20')
    expect(screen.getByTestId('presupuesto-total')).toHaveTextContent('$ 13.092,20')
    expect(screen.getByText(LEYENDA_PRESUPUESTO)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar presupuesto' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Volver a la lista' })).toBeInTheDocument()
  })

  it('confirmar manda la lista, la nota y la clave del intento; con ok avisa con número y total', async () => {
    mocks.crearPresupuesto.mockResolvedValue({ estado: 'exito', numero: '00000012', fecha: '2026-11-14', totalConIva: 13092.2 })
    montar('Después de las 18')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    await waitFor(() => expect(alConfirmado).toHaveBeenCalledWith({ numero: '00000012', totalConIva: 13092.2, cambioElPrecio: false }))
    expect(mocks.crearPresupuesto).toHaveBeenCalledWith(HOST, LINEAS, 'Después de las 18', CLAVE)
  })

  it('si el total confirmado difiere del cotizado lo informa para el aviso «El precio cambió»', async () => {
    mocks.crearPresupuesto.mockResolvedValue({ estado: 'exito', numero: '00000012', fecha: '2026-11-14', totalConIva: 12000 })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    await waitFor(() => expect(alConfirmado).toHaveBeenCalledWith({ numero: '00000012', totalConIva: 12000, cambioElPrecio: true }))
  })

  it('una sola petición de creación en vuelo (doble clic)', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.crearPresupuesto.mockReturnValue(new Promise((r) => { resolver = r }))
    montar()
    const boton = await screen.findByRole('button', { name: 'Confirmar presupuesto' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await screen.findByRole('button', { name: 'Confirmando…' })
    expect(mocks.crearPresupuesto).toHaveBeenCalledTimes(1)
    resolver({ estado: 'exito', numero: '00000001', fecha: '', totalConIva: 13092.2 })
    await waitFor(() => expect(alConfirmado).toHaveBeenCalledTimes(1))
  })

  it('productos no disponibles o sin precio: se listan por nombre y «Confirmar presupuesto» queda deshabilitado', async () => {
    mocks.cotizarPresupuesto.mockResolvedValue(cotizacion({ noDisponibles: [A], sinPrecio: [B] }))
    montar()
    expect(await screen.findByText('«Joystick» ya no está disponible. Quitalo para continuar.')).toBeInTheDocument()
    expect(screen.getByText('No pudimos calcular el precio de «Auricular». Quitalo de la lista o enviá el pedido sin presupuesto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar presupuesto' })).toBeDisabled()
  })

  it.each([
    [{ estado: 'sin_precio', productoId: B }, 'No pudimos calcular el precio de «Auricular». Quitalo de la lista o enviá el pedido sin presupuesto.'],
    [{ estado: 'no_disponible', productoId: A }, '«Joystick» ya no está disponible. Quitalo para continuar.'],
    [{ estado: 'espera', esperaSegundos: 125 }, 'Hiciste varios envíos seguidos. Probá de nuevo en 3 minutos.'],
    [{ estado: 'limite_cuenta' }, 'Ya tenés presupuestos abiertos. Esperá nuestra respuesta para pedir otro.'],
    [{ estado: 'invalido', campos: ['items'] }, 'Revisá tu lista: hay productos que no se pueden pedir en un presupuesto.'],
  ])('al confirmar, %j muestra el texto exacto y conserva la lista', async (respuesta, texto) => {
    mocks.crearPresupuesto.mockResolvedValue(respuesta)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    expect((await screen.findByTestId('resultado-presupuesto')).textContent).toContain(texto)
    expect(alConfirmado).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar presupuesto' })).toBeEnabled()
  })

  it('un error al crear ofrece «Reintentar» con la MISMA clave de envío', async () => {
    mocks.crearPresupuesto.mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValueOnce({ estado: 'exito', numero: '00000001', fecha: '', totalConIva: 13092.2 })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    expect((await screen.findByTestId('resultado-presupuesto')).textContent).toContain('No pudimos pedir tu presupuesto. Tu lista sigue acá: probá de nuevo.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(alConfirmado).toHaveBeenCalledTimes(1))
    expect(mocks.crearPresupuesto.mock.calls.map((llamada) => llamada[3])).toEqual([CLAVE, CLAVE])
  })

  it('sin_acceso al crear o al cotizar avisa a la pantalla (se comporta como visitante)', async () => {
    mocks.crearPresupuesto.mockResolvedValue({ estado: 'sin_acceso' })
    const { unmount } = montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar presupuesto' }))
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalledTimes(1))
    unmount()
    mocks.cotizarPresupuesto.mockResolvedValue({ estado: 'sin_acceso' })
    montar()
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalledTimes(2))
  })

  it('un error de cotización ofrece reintentar y no deja confirmar; «Volver a la lista» cierra', async () => {
    mocks.cotizarPresupuesto.mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValueOnce(cotizacion())
    montar()
    expect(await screen.findByText('No pudimos calcular tu presupuesto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar presupuesto' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(mocks.cotizarPresupuesto).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))
    expect(alCerrar).toHaveBeenCalledTimes(1)
  })

  it('el límite de cotizaciones muestra el tiempo de espera y no deja confirmar', async () => {
    mocks.cotizarPresupuesto.mockResolvedValue({ estado: 'espera', esperaSegundos: 30 })
    montar()
    expect(await screen.findByText('Hiciste varios envíos seguidos. Probá de nuevo en 1 minuto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar presupuesto' })).toBeDisabled()
  })

  it('los nombres de productos con HTML se muestran como texto', async () => {
    mocks.cotizarPresupuesto.mockResolvedValue({
      estado: 'ok',
      cotizacion: { lineas: [{ productoId: A, descripcion: '<img src=x onerror=alert(1)>', codigo: null, cantidad: 1, precioUnitario: 100, subtotalSinIva: 100, iva: 21, disponible: true }], totalSinIva: 100, iva: 21, totalConIva: 121, noDisponibles: [], sinPrecio: [] },
    })
    montar()
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  describe.each(ANCHOS_TIENDA)('a %i px', (ancho) => {
    it('sin violaciones de axe (cotizado y con productos que no se pueden pedir)', async () => {
      fijarAncho(ancho)
      const { baseElement, unmount } = montar()
      await screen.findByText('Joystick')
      expect(await violacionesAxe(baseElement)).toEqual([])
      unmount()
      mocks.cotizarPresupuesto.mockResolvedValue(cotizacion({ noDisponibles: [A], sinPrecio: [B] }))
      const segundo = montar()
      await screen.findByText('«Joystick» ya no está disponible. Quitalo para continuar.')
      expect(await violacionesAxe(segundo.baseElement)).toEqual([])
    })
  })
})
