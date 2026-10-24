import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-10 (MSF-365, SC-005): estados del comprobante en el detalle: catálogo de etiquetas y tonos (FR-023), chip y
// tarjeta Estado con ayuda y chips deshabilitados con motivo (FR-024), historial con carga/vacío/error (FR-027),
// error de transición y cambio de empresa activa que recarga (Principio VIII).

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  cambiarEstadoComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/depositos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/depositos')>()),
  listarDepositos: vi.fn(async () => []),
}))
vi.mock('../../lib/ventas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventas')>()),
  obtenerComprobante: mocks.obtenerComprobante,
  obtenerClienteParaComprobante: vi.fn(async () => null),
}))
vi.mock('../../lib/estadosComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/estadosComprobante')>()),
  cambiarEstadoComprobante: mocks.cambiarEstadoComprobante,
  transicionesPermitidas: mocks.transicionesPermitidas,
  historialComprobante: mocks.historialComprobante,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))

import type { Comprobante } from '../../lib/ventas'
import { ESTADOS_COMPROBANTE, definicionEstado, motivoDeshabilitado } from '../../lib/estadosComprobante'
import { ComprobanteVenta } from './comprobante'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', esActiva: true },
  { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
]

const accesibles = (activa: string | null) => ({
  empresas: EMPRESAS.map((empresa) => ({ ...empresa, esActiva: empresa.id === activa })),
  empresaActivaId: activa,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

const FACTURA: Comprobante = {
  id: 'k-1',
  tipo: 'factura',
  numero: '00000001',
  estado: 'confirmada',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: '20-12345678-3', direccion: 'Av. Ejemplo 1234', tipo: 'mayorista', es_consumidor_final: false },
  canal: 'mostrador',
  fecha: '2026-10-24',
  valido_hasta: null,
  operador_id: 'u-1',
  operador: 'Lucía Gómez',
  forma_pago_id: null,
  envio_id: null,
  lineas: [],
  total_sin_iva: 0,
  iva: 0,
  total_con_iva: 0,
  editable: false,
  puede_editar: true,
  puede_editar_precio: false,
  updated_at: '2026-10-24T10:00:00Z',
}

const EVENTOS = [
  { cuando: '2026-10-07T12:40:00Z', accion: 'Estado: Pendiente → Aceptado', quien: 'Javier', empresa_id: 'e-1', empresa: 'San Javucho' },
  { cuando: '2026-10-07T12:12:00Z', accion: 'Creó la factura 00000001 en San Javucho', quien: 'Javier', empresa_id: 'e-1', empresa: 'San Javucho' },
]

function UbicacionActual() {
  const ubicacion = useLocation()
  return <div>{`En ${ubicacion.pathname}: ${(ubicacion.state as { mensaje?: string } | null)?.mensaje ?? ''}`}</div>
}

const arbol = () => (
  <MemoryRouter initialEntries={['/ventas/comprobantes/k-1']}>
    <Routes>
      <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes" element={<UbicacionActual />} />
    </Routes>
  </MemoryRouter>
)

const tarjeta = () => within(screen.getByRole('region', { name: 'Estado' }))
const enTarjeta = async () => within(await screen.findByRole('region', { name: 'Estado' }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
  mocks.obtenerComprobante.mockResolvedValue(FACTURA)
  mocks.transicionesPermitidas.mockResolvedValue(['aceptado', 'en_proceso'])
  mocks.historialComprobante.mockResolvedValue(EVENTOS)
})

describe('Catálogo de estados (FR-023)', () => {
  it('cada estado tiene su etiqueta y su tono; confirmada se muestra «Pendiente» y no hay «Entregado»', () => {
    const esperado: Record<string, [string, string]> = {
      borrador: ['Borrador', 'neutral'],
      confirmada: ['Pendiente', 'neutral'],
      pendiente: ['Pendiente', 'neutral'],
      aceptado: ['Aceptado', 'contorno'],
      cobrado: ['Cobrado', 'exito'],
      en_proceso: ['En proceso', 'info'],
      deuda: ['Deuda', 'error'],
      armando: ['Armando', 'primario'],
      incompleto: ['Incompleto', 'aviso'],
      anulada: ['Anulada', 'contorno'],
    }
    for (const [estado, [etiqueta, tono]] of Object.entries(esperado)) {
      expect(definicionEstado(estado)).toMatchObject({ etiqueta, tono })
    }
    expect(Object.keys(ESTADOS_COMPROBANTE).sort()).toEqual(Object.keys(esperado).sort())
    expect(Object.values(ESTADOS_COMPROBANTE).map((d) => d.etiqueta)).not.toContain('Entregado')
  })

  it('el motivo de un chip deshabilitado distingue cobro, borrador, anulada y falta de transición', () => {
    expect(motivoDeshabilitado('confirmada', 'cobrado', ['aceptado'])).toMatch(/cobro/)
    expect(motivoDeshabilitado('borrador', 'aceptado', [])).toMatch(/Confirmá/)
    expect(motivoDeshabilitado('anulada', 'aceptado', [])).toMatch(/anulada/)
    expect(motivoDeshabilitado('confirmada', 'armando', ['aceptado'])).toBe('Tu rol no puede pasar de Pendiente a Armando.')
    expect(motivoDeshabilitado('confirmada', 'aceptado', ['aceptado'])).toBeNull()
    expect(motivoDeshabilitado('aceptado', 'aceptado', [])).toBeNull()
  })
})

describe('Detalle · tarjeta Estado y chip (FR-024)', () => {
  it('muestra el chip «Pendiente» junto al título y la tarjeta con los siete estados y su ayuda', async () => {
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    for (const nombre of ['Pendiente', 'Aceptado', 'Cobrado', 'En proceso', 'Deuda', 'Armando', 'Incompleto']) {
      expect(await (await enTarjeta()).findByRole('button', { name: new RegExp(`^${nombre}`) })).toBeInTheDocument()
    }
    expect(tarjeta().queryByRole('button', { name: /Entregado/ })).not.toBeInTheDocument()
    expect(tarjeta().getByRole('button', { name: 'Pendiente' })).toHaveAttribute('aria-pressed', 'true')
    expect(tarjeta().getByText('Creado: el stock queda reservado, todavía no se descuenta.')).toBeInTheDocument()
  })

  it('deshabilita con motivo los chips que el rol no puede elegir y habilita los permitidos', async () => {
    render(arbol())
    const aceptado = await (await enTarjeta()).findByRole('button', { name: 'Aceptado' })
    await waitFor(() => expect(aceptado).toBeEnabled())
    expect(tarjeta().getByRole('button', { name: 'En proceso' })).toBeEnabled()
    const armando = tarjeta().getByRole('button', { name: /^Armando/ })
    expect(armando).toBeDisabled()
    expect(armando).toHaveAccessibleName('Armando. Tu rol no puede pasar de Pendiente a Armando.')
    // Cobrado y Deuda existen pero ninguna persona los elige.
    expect(tarjeta().getByRole('button', { name: /^Cobrado/ })).toBeDisabled()
    expect(tarjeta().getByRole('button', { name: /^Cobrado/ })).toHaveAccessibleName(/Se actualiza solo con el cobro/)
    expect(tarjeta().getByRole('button', { name: /^Deuda/ })).toBeDisabled()
  })

  it('un rol sin transiciones (p. ej. Consulta) ve todos los chips deshabilitados', async () => {
    mocks.transicionesPermitidas.mockResolvedValue([])
    render(arbol())
    await (await enTarjeta()).findByRole('button', { name: 'Pendiente' })
    await waitFor(() => expect(mocks.transicionesPermitidas).toHaveBeenCalled())
    for (const nombre of ['Aceptado', 'En proceso', 'Armando', 'Incompleto']) {
      expect(tarjeta().getByRole('button', { name: new RegExp(`^${nombre}`) })).toBeDisabled()
    }
  })

  it('elegir un estado llama a la base con la fecha vigente, actualiza chip y ayuda y relee el historial', async () => {
    mocks.cambiarEstadoComprobante.mockResolvedValue({ estado: 'aceptado', updated_at: '2026-10-24T11:00:00Z' })
    render(arbol())
    const aceptado = await (await enTarjeta()).findByRole('button', { name: 'Aceptado' })
    await waitFor(() => expect(aceptado).toBeEnabled())
    const lecturasPrevias = mocks.historialComprobante.mock.calls.length
    fireEvent.click(aceptado)
    await waitFor(() => expect(mocks.cambiarEstadoComprobante).toHaveBeenCalledWith('k-1', 'aceptado', '2026-10-24T10:00:00Z'))
    expect(await (await enTarjeta()).findByRole('button', { name: 'Aceptado' })).toHaveAttribute('aria-pressed', 'true')
    expect(tarjeta().getByText('El cliente aceptó el presupuesto.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.historialComprobante.mock.calls.length).toBeGreaterThan(lecturasPrevias))
    expect(mocks.transicionesPermitidas.mock.calls.length).toBeGreaterThan(1)
  })

  it('si la base rechaza la transición muestra su mensaje y deja el estado como estaba', async () => {
    mocks.cambiarEstadoComprobante.mockRejectedValue({ code: '42501', message: 'Tu rol (Mostrador) no puede pasar la factura de Pendiente a Aceptado' })
    render(arbol())
    const aceptado = await (await enTarjeta()).findByRole('button', { name: 'Aceptado' })
    await waitFor(() => expect(aceptado).toBeEnabled())
    fireEvent.click(aceptado)
    expect(await screen.findByText('Tu rol (Mostrador) no puede pasar la factura de Pendiente a Aceptado')).toBeInTheDocument()
    expect(tarjeta().getByRole('button', { name: 'Pendiente' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ante un conflicto de edición (40001) avisa y recarga el comprobante', async () => {
    mocks.cambiarEstadoComprobante.mockRejectedValue({ code: '40001', message: 'Alguien modificó' })
    render(arbol())
    const aceptado = await (await enTarjeta()).findByRole('button', { name: 'Aceptado' })
    await waitFor(() => expect(aceptado).toBeEnabled())
    fireEvent.click(aceptado)
    expect(await screen.findByText(/Otra persona modificó este comprobante mientras lo mirabas/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
  })

  it('un presupuesto no tiene tarjeta Estado y un borrador la muestra con todo deshabilitado', async () => {
    mocks.obtenerComprobante.mockResolvedValueOnce({ ...FACTURA, tipo: 'presupuesto', numero: '00000002', estado: 'pendiente' })
    const { unmount } = render(arbol())
    expect(await screen.findByRole('heading', { name: 'Presupuesto 00000002' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Estado' })).not.toBeInTheDocument()
    unmount()

    mocks.obtenerComprobante.mockResolvedValue({ ...FACTURA, estado: 'borrador', editable: true })
    mocks.transicionesPermitidas.mockResolvedValue([])
    render(arbol())
    const aceptado = await (await enTarjeta()).findByRole('button', { name: /^Aceptado/ })
    expect(aceptado).toBeDisabled()
    expect(aceptado).toHaveAccessibleName(/Confirmá la factura/)
    expect(screen.getAllByText('Borrador').length).toBeGreaterThan(0)
  })

  it('se puede operar con el teclado: los chips habilitados son botones enfocables', async () => {
    mocks.cambiarEstadoComprobante.mockResolvedValue({ estado: 'en_proceso', updated_at: '2026-10-24T11:00:00Z' })
    render(arbol())
    const enProceso = await (await enTarjeta()).findByRole('button', { name: 'En proceso' })
    await waitFor(() => expect(enProceso).toBeEnabled())
    enProceso.focus()
    expect(enProceso).toHaveFocus()
    fireEvent.click(enProceso)
    await waitFor(() => expect(mocks.cambiarEstadoComprobante).toHaveBeenCalledWith('k-1', 'en_proceso', '2026-10-24T10:00:00Z'))
  })
})

describe('Detalle · Historial de estados y acciones (FR-027)', () => {
  it('lista Cuándo, Acción, Quién y Tienda con su subtítulo y la nota de pie', async () => {
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Historial de estados y acciones' })).toBeInTheDocument()
    expect(screen.getByText('Quién hizo cada cambio, cuándo y desde qué tienda.')).toBeInTheDocument()
    const tabla = await screen.findByRole('table', { name: 'Historial de estados y acciones' })
    for (const encabezado of ['Cuándo', 'Acción', 'Quién', 'Tienda']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('Estado: Pendiente → Aceptado')).toBeInTheDocument()
    expect(within(tabla).getAllByText('San Javucho').length).toBe(2)
    expect(screen.getByText(/El comprobante pertenece a una sola tienda/)).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras lee', async () => {
    mocks.historialComprobante.mockReturnValue(new Promise(() => undefined))
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Historial de estados y acciones' })).toBeInTheDocument()
    expect(screen.getAllByRole('status', { name: 'Cargando contenido' }).length).toBeGreaterThan(0)
  })

  it('sin eventos muestra el estado vacío', async () => {
    mocks.historialComprobante.mockResolvedValue([])
    render(arbol())
    expect(await screen.findByText('Todavía no hay movimientos')).toBeInTheDocument()
  })

  it('si falla la lectura muestra el error y «Reintentar» vuelve a leer', async () => {
    mocks.historialComprobante.mockRejectedValueOnce(new Error('caído')).mockResolvedValue(EVENTOS)
    render(arbol())
    expect(await screen.findByText('No pudimos cargar el historial del comprobante.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Historial de estados y acciones' })).toBeInTheDocument()
  })
})

describe('Detalle · empresa activa (Principio VIII)', () => {
  it('al cambiar a la tienda del comprobante desde «Todas» recarga estados e historial', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    const { rerender } = render(arbol())
    await (await enTarjeta()).findByRole('button', { name: 'Pendiente' })
    await waitFor(() => expect(mocks.historialComprobante).toHaveBeenCalled())
    const permitidasPrevias = mocks.transicionesPermitidas.mock.calls.length
    const historialPrevio = mocks.historialComprobante.mock.calls.length
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    rerender(arbol())
    await waitFor(() => expect(mocks.transicionesPermitidas.mock.calls.length).toBeGreaterThan(permitidasPrevias))
    await waitFor(() => expect(mocks.historialComprobante.mock.calls.length).toBeGreaterThan(historialPrevio))
  })

  it('al cambiar a otra tienda cierra el comprobante con aviso y no deja datos de la anterior', async () => {
    const { rerender } = render(arbol())
    await (await enTarjeta()).findByRole('button', { name: 'Pendiente' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender(arbol())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos el comprobante/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Estado' })).not.toBeInTheDocument()
  })
})
