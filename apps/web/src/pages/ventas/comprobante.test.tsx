import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  crearComprobante: vi.fn(),
  guardarComprobante: vi.fn(),
  obtenerClienteParaComprobante: vi.fn(),
  confirmarComprobante: vi.fn(),
  copiarPresupuesto: vi.fn(),
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
  crearComprobante: mocks.crearComprobante,
  guardarComprobante: mocks.guardarComprobante,
  obtenerClienteParaComprobante: mocks.obtenerClienteParaComprobante,
}))
vi.mock('../../lib/ventasConfirmacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasConfirmacion')>()),
  confirmarComprobante: mocks.confirmarComprobante,
}))
vi.mock('../../lib/estadosComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/estadosComprobante')>()),
  transicionesPermitidas: mocks.transicionesPermitidas,
  historialComprobante: mocks.historialComprobante,
}))
vi.mock('../../lib/ventasPresupuestos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasPresupuestos')>()),
  copiarPresupuesto: mocks.copiarPresupuesto,
}))
vi.mock('../../lib/ventasDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: vi.fn(async () => ({
    estado_despacho: 'sin_armar',
    armo_id: null,
    armo: null,
    controlo_id: null,
    controlo: null,
    entrego_id: null,
    entrego: null,
    entregado_en: null,
    updated_at: '2026-10-24T10:00:00Z',
    puede_despachar: false,
  })),
  listarResponsablesDespacho: vi.fn(async () => []),
  cambiarEstadoDespacho: vi.fn(async () => undefined),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({
  ClienteSelector: (props: {
    valor: { nombre: string } | null
    onCambio: (cliente: { id: string; nombre: string; contacto: string } | null) => void
    error?: string
    disabled?: boolean
  }) => (
    <div>
      <span data-testid="cliente">{props.valor?.nombre ?? 'sin cliente'}</span>
      <button type="button" disabled={props.disabled} onClick={() => props.onCambio({ id: 'c-2', nombre: 'Consumidor final', contacto: '' })}>
        Elegir Consumidor final
      </button>
      {props.error ? <span>{props.error}</span> : null}
    </div>
  ),
}))

import type { Comprobante } from '../../lib/ventas'
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

const COMPROBANTE: Comprobante = {
  id: 'k-1',
  tipo: 'factura',
  numero: '00000001',
  estado: 'borrador',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: '20-12345678-3', direccion: 'Av. Ejemplo 1234, Rosario', tipo: 'mayorista', es_consumidor_final: false },
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
  editable: true,
  puede_editar: true,
  puede_editar_precio: true,
  updated_at: '2026-10-24T10:00:00Z',
}

function UbicacionActual() {
  const ubicacion = useLocation()
  return <div>{`En ${ubicacion.pathname}: ${(ubicacion.state as { mensaje?: string } | null)?.mensaje ?? ''}`}</div>
}

const arbol = (ruta: string) => (
  <MemoryRouter initialEntries={[ruta]}>
    <Routes>
      <Route path="/ventas/comprobantes/nuevo" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes" element={<UbicacionActual />} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
  mocks.obtenerComprobante.mockResolvedValue(COMPROBANTE)
  mocks.transicionesPermitidas.mockResolvedValue([])
  mocks.historialComprobante.mockResolvedValue([])
  mocks.obtenerClienteParaComprobante.mockResolvedValue({
    id: 'c-2', nombre: 'Consumidor final', documento: null, direccion: null, tipo: 'minorista', es_consumidor_final: true,
  })
})

describe('Comprobante de venta · alta (F-VTA-05)', () => {
  it('preselecciona la empresa activa como Tienda y ofrece los canales sin Mercado Libre', async () => {
    render(arbol('/ventas/comprobantes/nuevo'))
    const san = await screen.findByRole('button', { name: 'San Javucho' })
    expect(san).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Mostrador' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tienda online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Teléfono/WhatsApp' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mercado Libre/ })).not.toBeInTheDocument()
    expect(screen.getByText('Mercado Libre todavía no está disponible como canal.')).toBeInTheDocument()
  })

  it('muestra los datos de lectura del cliente elegido, incluido Consumidor final', async () => {
    render(arbol('/ventas/comprobantes/nuevo'))
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir Consumidor final' }))
    expect(screen.getByTestId('cliente')).toHaveTextContent('Consumidor final')
    await waitFor(() => expect(mocks.obtenerClienteParaComprobante).toHaveBeenCalledWith('c-2'))
    expect(screen.getByLabelText('CUIT / DNI')).toHaveValue('—')
    expect(screen.getByLabelText('Dirección de entrega')).toHaveValue('—')
    expect(screen.getByLabelText('Condición frente al IVA')).toHaveValue('—')
  })

  it('exige el cliente antes de guardar y no llama a la base', async () => {
    render(arbol('/ventas/comprobantes/nuevo'))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Elegí un cliente o Consumidor final.')).toBeInTheDocument()
    expect(mocks.crearComprobante).not.toHaveBeenCalled()
  })

  it('crea la factura en la tienda activa y abre el comprobante con su número', async () => {
    mocks.crearComprobante.mockResolvedValue({ id: 'k-9', tipo: 'factura', numero: '00000007' })
    render(arbol('/ventas/comprobantes/nuevo'))
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir Consumidor final' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.crearComprobante).toHaveBeenCalledTimes(1))
    expect(mocks.crearComprobante).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'factura', empresa_id: 'e-1', canal: 'mostrador', cliente: expect.objectContaining({ id: 'c-2' }) }),
    )
    // La ruta nueva (`/:id`) vuelve a montar la pantalla: se lee el comprobante recién creado.
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledWith('k-9'))
  })

  it('el presupuesto pide «Válido hasta» y rechaza una validez anterior a la fecha', async () => {
    render(arbol('/ventas/comprobantes/nuevo?tipo=presupuesto'))
    expect(await screen.findByRole('heading', { name: 'Nuevo presupuesto' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir Consumidor final' }))
    fireEvent.change(screen.getByLabelText(/^Fecha/), { target: { value: '2026-10-24' } })
    fireEvent.change(screen.getByLabelText('Válido hasta'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('La validez no puede ser anterior a la fecha.')).toBeInTheDocument()
    expect(mocks.crearComprobante).not.toHaveBeenCalled()
  })

  it('con «Todas mis empresas» obliga a elegir la tienda', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    render(arbol('/ventas/comprobantes/nuevo'))
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir Consumidor final' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Elegí la tienda.')).toBeInTheDocument()
    expect(mocks.crearComprobante).not.toHaveBeenCalled()
  })
})

describe('Comprobante de venta · edición (F-VTA-05)', () => {
  it('bloquea la Tienda de un comprobante guardado y explica por qué', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Mundo JC' })).not.toBeInTheDocument()
    expect(screen.getByText(/La tienda no se puede cambiar/)).toBeInTheDocument()
    expect(screen.getByLabelText('CUIT / DNI')).toHaveValue('20-12345678-3')
    expect(screen.getByLabelText('Dirección de entrega')).toHaveValue('Av. Ejemplo 1234, Rosario')
    expect(screen.getByLabelText('Operador')).toHaveValue('Lucía Gómez')
  })

  it('guarda los cambios con el bloqueo optimista del comprobante', async () => {
    mocks.guardarComprobante.mockResolvedValue({ ...COMPROBANTE, canal: 'tienda_online', updated_at: '2026-10-24T11:00:00Z' })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Tienda online' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.guardarComprobante).toHaveBeenCalledTimes(1))
    expect(mocks.guardarComprobante.mock.calls[0][0]).toMatchObject({ id: 'k-1', updated_at: '2026-10-24T10:00:00Z' })
    expect(mocks.guardarComprobante.mock.calls[0][1]).toMatchObject({ canal: 'tienda_online' })
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument()
  })

  it('avisa el conflicto de edición y ofrece recargar', async () => {
    mocks.guardarComprobante.mockRejectedValue({ code: '40001', message: 'x' })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó este comprobante/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
  })

  it('si guardó pero la relectura falló, avisa «Guardado» y ofrece recargar (no dice que no se guardó)', async () => {
    mocks.guardarComprobante.mockResolvedValue(null)
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Guardado; recargá para ver el estado actual/)).toBeInTheDocument()
    expect(screen.queryByText(/No pudimos guardar/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
  })

  it('un documento cerrado se ve en solo lectura, sin «Guardar cambios»', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, estado: 'confirmada', editable: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByText('Este comprobante ya está cerrado: solo se puede consultar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tienda online' })).toBeDisabled()
    // `confirmada` se muestra «Pendiente» (FR-023): en el chip del título y en la tarjeta Estado.
    expect(screen.getAllByText('Pendiente').length).toBeGreaterThan(0)
    expect(screen.queryByText('Confirmada')).not.toBeInTheDocument()
  })

  it('un presupuesto aceptado tampoco se edita', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', numero: '00000002', estado: 'aceptado', editable: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Presupuesto 00000002' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.getByText('Aceptado')).toBeInTheDocument()
  })

  it('«Copiar» (F-VTA-08): en un presupuesto, aun aceptado, crea la copia y abre su edición; en una factura no existe', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', numero: '00000002', estado: 'aceptado', editable: false })
    mocks.copiarPresupuesto.mockResolvedValue({ id: 'k-9', numero: '00000007', estado: 'pendiente' })
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar' }))
    await waitFor(() => expect(mocks.copiarPresupuesto).toHaveBeenCalledWith('k-1'))
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledWith('k-9'))
    vista.unmount()
    mocks.obtenerComprobante.mockResolvedValue(COMPROBANTE)
    render(arbol('/ventas/comprobantes/k-1'))
    await screen.findByRole('button', { name: 'Guardar cambios' })
    expect(screen.queryByRole('button', { name: 'Copiar' })).not.toBeInTheDocument()
  })

  it('con ventas en lectura oculta los controles de edición', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, puede_editar: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByText('Tu rol puede ver este comprobante, no modificarlo.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tienda online' })).toBeDisabled()
  })

  it('un comprobante inexistente muestra el error con opción de reintentar', async () => {
    mocks.obtenerComprobante.mockRejectedValue({ code: 'P0002', message: 'no existe' })
    render(arbol('/ventas/comprobantes/k-404'))
    expect(await screen.findByText('Ese comprobante no existe o no pertenece a tu organización.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('Comprobante de venta · empresa activa (Principio VIII, FR-007)', () => {
  it('en un alta, cambiar la empresa activa reencuadra la Tienda a la nueva', async () => {
    const vista = render(arbol('/ventas/comprobantes/nuevo'))
    expect(await screen.findByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'true')
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    vista.rerender(arbol('/ventas/comprobantes/nuevo'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('un comprobante abierto se cierra con aviso al cambiar a otra tienda', async () => {
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByText(/En \/ventas\/comprobantes: Cambiaste de tienda/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Factura 00000001' })).not.toBeInTheDocument()
  })

  it('si la tienda cambia mientras el comprobante carga, se cierra al terminar la carga', async () => {
    let resolver: (c: Comprobante) => void = () => undefined
    mocks.obtenerComprobante.mockReturnValue(new Promise<Comprobante>((r) => (resolver = r)))
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalled())
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))
    resolver(COMPROBANTE)
    expect(await screen.findByText(/En \/ventas\/comprobantes: Cambiaste de tienda/)).toBeInTheDocument()
  })

  it('un comprobante abierto sigue igual si la empresa activa no cambia de tienda', async () => {
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))
    expect(screen.getByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
  })
})

describe('Comprobante de venta · Confirmar factura (F-VTA-07)', () => {
  const LINEA = {
    id: 'l-1', orden: 1, producto_id: 'p-1', descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precio_unitario: 800,
    escala: 'x1' as const, precio_manual: false, alicuota_porcentaje: 21, deposito_id: 'd-1', deposito: 'Principal', a_pedido: false,
    stock: 10, reservado: 0, subtotal_sin_iva: 2400, iva: 504,
  }

  it('confirma desde el diálogo y el comprobante queda de solo lectura', async () => {
    mocks.obtenerComprobante
      .mockResolvedValueOnce({ ...COMPROBANTE, lineas: [LINEA] })
      .mockResolvedValueOnce({ ...COMPROBANTE, lineas: [LINEA], estado: 'confirmada', editable: false })
    mocks.confirmarComprobante.mockResolvedValue(undefined)
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar factura' }))
    expect(mocks.confirmarComprobante).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.confirmarComprobante).toHaveBeenCalledWith('k-1'))
    expect(await screen.findByText('Factura 00000001 confirmada')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirmar factura' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('muestra el error de stock y el comprobante sigue en borrador', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, lineas: [LINEA] })
    mocks.confirmarComprobante.mockRejectedValue({
      code: 'P0001',
      hint: 'stock',
      message: 'No hay stock suficiente de Joystick en el depósito Principal: hay 2 y la factura pide 3',
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar factura' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Joystick en el depósito Principal')
    expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1)
  })

  it('no ofrece el botón en un presupuesto, sin líneas ni con solo lectura', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', estado: 'pendiente', lineas: [LINEA] })
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Presupuesto 00000001' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar factura' })).not.toBeInTheDocument()
    vista.unmount()

    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, lineas: [] })
    const sinLineas = render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar factura' })).not.toBeInTheDocument()
    sinLineas.unmount()

    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, lineas: [LINEA], puede_editar: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar factura' })).not.toBeInTheDocument()
  })
})

describe('Comprobante de venta · Imprimir (F-VTA-19)', () => {
  const confirmada = { ...COMPROBANTE, estado: 'confirmada', editable: false }

  it('una factura confirmada ofrece «Imprimir» en la cabecera y «Imprimir remito» en Documentos', async () => {
    mocks.obtenerComprobante.mockResolvedValue(confirmada)
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir remito' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(await screen.findByRole('dialog', { name: 'Imprimir comprobante' })).toBeInTheDocument()
  })

  it('una factura en borrador no ofrece imprimir y dice por qué', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByText('La factura tiene que estar confirmada para imprimirla.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir remito' })).not.toBeInTheDocument()
  })

  it('`lectura` puede imprimir una factura confirmada', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue({ ...confirmada, puede_editar: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
  })

  it('sin acceso a Ventas no se ofrece imprimir', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue(confirmada)
    render(arbol('/ventas/comprobantes/k-1'))
    await screen.findByText(/Factura 00000001/)
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument()
  })

  it('un presupuesto ofrece «Imprimir» en la cabecera y «Enviar por correo» en Documentos, sin remito (F-VTA-20, FR-026)', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', estado: 'pendiente' })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar por correo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir remito' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(await screen.findByRole('radio', { name: /Presupuesto/ })).toBeChecked()
  })

  it('con `lectura` un presupuesto se imprime pero no se envía por correo (FR-028)', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', estado: 'aceptado', puede_editar: false })
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar por correo' })).not.toBeInTheDocument()
  })

  it('un presupuesto convertido en factura no muestra la tarjeta Documentos', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, tipo: 'presupuesto', estado: 'convertido' })
    render(arbol('/ventas/comprobantes/k-1'))
    await screen.findByText(/Presupuesto 00000001/)
    expect(screen.queryByRole('heading', { name: 'Documentos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument()
  })
})
