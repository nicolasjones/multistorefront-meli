import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-11 (MSF-377, SC-008): anulación y nota de crédito en el detalle. Diálogo Anular (motivo obligatorio, éxito,
// error y solo lectura posterior) (FR-042), diálogo Nota de crédito (tres motivos, emisión y error de tope) (FR-045),
// tarjeta de la nota con importes negativos (FR-046), permisos que ocultan las acciones, cambio de empresa activa
// (Principio VIII) y teclado.

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  detalleAnulacionNotaCredito: vi.fn(),
  anularComprobante: vi.fn(),
  emitirNotaCredito: vi.fn(),
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
  transicionesPermitidas: mocks.transicionesPermitidas,
  historialComprobante: mocks.historialComprobante,
}))
vi.mock('../../lib/anularComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/anularComprobante')>()),
  anularComprobante: mocks.anularComprobante,
}))
vi.mock('../../lib/notaCredito', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notaCredito')>()),
  detalleAnulacionNotaCredito: mocks.detalleAnulacionNotaCredito,
  emitirNotaCredito: mocks.emitirNotaCredito,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))

import type { Comprobante } from '../../lib/ventas'
import { MENSAJE_ERROR_ANULAR, MENSAJE_MOTIVO_OBLIGATORIO, mensajeDeAnulacion } from '../../lib/anularComprobante'
import {
  EJEMPLO_NOTA_CREDITO,
  MENSAJE_ERROR_NOTA,
  MENSAJE_SIN_CANTIDADES,
  TIPOS_NOTA_CREDITO,
  mensajeDeNotaCredito,
  type DetalleAnulacion,
} from '../../lib/notaCredito'
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
  total_sin_iva: 1000,
  iva: 210,
  total_con_iva: 1210,
  editable: false,
  puede_editar: true,
  puede_editar_precio: false,
  updated_at: '2026-10-24T10:00:00Z',
}

const ANULADA: Comprobante = {
  ...FACTURA,
  estado: 'anulada',
  editable: false,
  updated_at: '2026-10-24T11:00:00Z',
}

const DETALLE: DetalleAnulacion = {
  puede_anular: true,
  puede_emitir_nota_credito: true,
  anulacion: null,
  acreditable_sin_iva: 1000,
  lineas_acreditables: [
    { linea_id: 'l-1', orden: 1, descripcion: 'Transformador Switch', cantidad: 2, devuelta: 0, disponible: 2, precio_unitario: 500, deposito: 'Depósito Central' },
    { linea_id: 'l-2', orden: 2, descripcion: 'Cable HDMI', cantidad: 1, devuelta: 1, disponible: 0, precio_unitario: 200, deposito: 'Local' },
  ],
  notas: [],
}

const DETALLE_ANULADA: DetalleAnulacion = {
  ...DETALLE,
  puede_anular: false,
  puede_emitir_nota_credito: false,
  anulacion: { cuando: '2026-10-24T11:00:00Z', quien: 'Lucía Gómez', motivo: 'Error de carga' },
}

const NOTA = {
  id: 'n-1',
  numero: '00000002',
  nc_tipo: 'devolucion_productos' as const,
  concepto: null,
  fecha: '2026-10-24',
  total_sin_iva: 500,
  total_con_iva: 605,
  lineas: [
    { orden: 1, descripcion: 'Transformador Switch', cantidad: 1, precio_unitario: 500, subtotal_sin_iva: 500, iva: 105 },
  ],
}

const DETALLE_CON_NOTA: DetalleAnulacion = {
  ...DETALLE,
  puede_anular: false,
  puede_emitir_nota_credito: false,
  notas: [NOTA],
}

let comprobanteActual: Comprobante
let detalleActual: DetalleAnulacion

const arbol = () => (
  <MemoryRouter initialEntries={['/ventas/comprobantes/k-1']}>
    <Routes>
      <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes" element={<UbicacionActual />} />
    </Routes>
  </MemoryRouter>
)

function UbicacionActual() {
  const ubicacion = useLocation()
  return <div>{`En ${ubicacion.pathname}: ${(ubicacion.state as { mensaje?: string } | null)?.mensaje ?? ''}`}</div>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  comprobanteActual = FACTURA
  detalleActual = DETALLE
  mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
  mocks.obtenerComprobante.mockImplementation(async () => comprobanteActual)
  mocks.detalleAnulacionNotaCredito.mockImplementation(async () => detalleActual)
  mocks.anularComprobante.mockResolvedValue({ estado: 'anulada', updated_at: ANULADA.updated_at })
  mocks.emitirNotaCredito.mockResolvedValue({ id: 'n-1', numero: '00000002' })
  mocks.transicionesPermitidas.mockResolvedValue([])
  mocks.historialComprobante.mockResolvedValue([])
})

describe('Diálogo Anular (FR-042)', () => {
  it('pide el motivo, anula y deja la factura de solo lectura con el chip y el motivo', async () => {
    mocks.anularComprobante.mockImplementation(async () => {
      comprobanteActual = ANULADA
      detalleActual = DETALLE_ANULADA
      return { estado: 'anulada', updated_at: ANULADA.updated_at }
    })
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }))

    const dialogo = within(await screen.findByRole('dialog'))
    expect(dialogo.getByRole('heading', { name: 'Anular factura 00000001' })).toBeInTheDocument()
    const motivo = dialogo.getByRole('textbox', { name: /Motivo de la anulación/ })
    // El foco entra al motivo al abrir: se completa solo con teclado.
    await waitFor(() => expect(motivo).toHaveFocus())

    fireEvent.click(dialogo.getByRole('button', { name: 'Anular factura' }))
    expect(await dialogo.findByText(MENSAJE_MOTIVO_OBLIGATORIO)).toBeInTheDocument()
    expect(mocks.anularComprobante).not.toHaveBeenCalled()

    fireEvent.change(motivo, { target: { value: 'Error de carga' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Anular factura' }))

    await waitFor(() => expect(mocks.anularComprobante).toHaveBeenCalledWith('k-1', 'Error de carga', FACTURA.updated_at))
    expect(await screen.findByText(/Factura anulada el .* por Lucía Gómez: «Error de carga»/)).toBeInTheDocument()
    expect(await screen.findByText('Factura 00000001 anulada')).toBeInTheDocument()
    expect(await screen.findByText('Anulada')).toBeInTheDocument()
    // Después de anular ya no se ofrecen las acciones: es de solo lectura.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Nota de crédito' })).not.toBeInTheDocument()
  })

  it('muestra el error de la base sin cerrar el diálogo y deja reintentar', async () => {
    mocks.anularComprobante.mockRejectedValue({
      code: '55000',
      message: 'La factura ya tiene una nota de crédito: corregila con otra nota de crédito',
    })
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }))
    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Motivo de la anulación/ }), { target: { value: 'Duplicada' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Anular factura' }))

    expect(await dialogo.findByText(/ya tiene una nota de crédito/)).toBeInTheDocument()
    expect(dialogo.getByRole('button', { name: 'Anular factura' })).toBeEnabled()
  })

  it('se cancela con el teclado (Escape) sin anular nada', async () => {
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.anularComprobante).not.toHaveBeenCalled()
  })

  it('traduce los errores: conflicto de edición y detalle técnico filtrado', () => {
    expect(mensajeDeAnulacion({ code: '40001', message: 'Alguien modificó este comprobante' })).toMatch(/Otra persona modificó/)
    expect(mensajeDeAnulacion({ code: '42501', message: 'permission denied for function anular_comprobante' })).toBe(MENSAJE_ERROR_ANULAR)
    expect(mensajeDeAnulacion({ code: 'P0002' })).toMatch(/no existe o no pertenece/)
  })
})

describe('Diálogo Nota de crédito (FR-045)', () => {
  it('ofrece los tres motivos con su descripción, el ejemplo y los botones del prototipo', async () => {
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    const dialogo = within(await screen.findByRole('dialog'))
    expect(dialogo.getByRole('heading', { name: 'Nota de crédito' })).toBeInTheDocument()
    expect(dialogo.getByText(/Se emite una nota de crédito asociada a Factura 00000001/)).toBeInTheDocument()
    for (const tipo of TIPOS_NOTA_CREDITO) {
      expect(dialogo.getByRole('radio', { name: new RegExp(tipo.etiqueta) })).toBeInTheDocument()
      expect(dialogo.getByText(tipo.descripcion)).toBeInTheDocument()
    }
    expect(dialogo.getByText(EJEMPLO_NOTA_CREDITO)).toBeInTheDocument()
    expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(dialogo.getByRole('button', { name: 'Emitir nota de crédito' })).toBeInTheDocument()
  })

  it('emite «Devolución de productos» con las cantidades por línea', async () => {
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Cantidad a devolver de Transformador Switch/ }), { target: { value: '2' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Emitir nota de crédito' }))

    await waitFor(() => expect(mocks.emitirNotaCredito).toHaveBeenCalledWith('k-1', 'devolucion_productos', [{ linea_id: 'l-1', cantidad: 2 }], ''))
    expect(await screen.findByText('Nota de crédito emitida 00000002')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('no deja devolver más de lo disponible y no llama a la base', async () => {
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Cantidad a devolver de Transformador Switch/ }), { target: { value: '3' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Emitir nota de crédito' }))

    expect(await dialogo.findByText('Quedan 2 por devolver.')).toBeInTheDocument()
    expect(mocks.emitirNotaCredito).not.toHaveBeenCalled()
  })

  it('sin cantidades avisa y no emite', async () => {
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.click(dialogo.getByRole('button', { name: 'Emitir nota de crédito' }))
    expect(await dialogo.findByText(MENSAJE_SIN_CANTIDADES)).toBeInTheDocument()
    expect(mocks.emitirNotaCredito).not.toHaveBeenCalled()
  })

  it('«Devolución de importe» pide importe y concepto y muestra el error de tope sin cerrarse', async () => {
    mocks.emitirNotaCredito.mockRejectedValue({
      code: 'P0001',
      hint: 'tope',
      message: 'No podés acreditar más de lo facturado: quedan 100 por acreditar (sin IVA)',
    })
    render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.click(dialogo.getByRole('radio', { name: /Devolución de importe/ }))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Importe sin IVA/ }), { target: { value: '1500' } })
    fireEvent.change(dialogo.getByRole('textbox', { name: /Concepto/ }), { target: { value: 'Ajuste de precio' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Emitir nota de crédito' }))

    await waitFor(() =>
      expect(mocks.emitirNotaCredito).toHaveBeenCalledWith('k-1', 'devolucion_importe', [{ importe_sin_iva: 1500 }], 'Ajuste de precio'),
    )
    expect(await dialogo.findByText(/No podés acreditar más de lo facturado/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('traduce los errores: tope propio y detalle técnico filtrado', () => {
    expect(mensajeDeNotaCredito({ code: 'P0001', hint: 'tope', message: 'No podés devolver más de lo facturado: de X quedan 1 por acreditar' }))
      .toMatch(/No podés devolver más/)
    expect(mensajeDeNotaCredito({ code: '42501', message: 'permission denied for function emitir_nota_credito' })).toBe(MENSAJE_ERROR_NOTA)
  })
})

describe('Tarjeta de la nota (FR-046)', () => {
  it('muestra número, etiqueta, tipo, descripción y la tabla con cantidades e importes negativos', async () => {
    detalleActual = DETALLE_CON_NOTA
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Nota de crédito 00000002' })).toBeInTheDocument()
    expect(screen.getByText('Asociada a esta factura')).toBeInTheDocument()
    expect(screen.getByText(/Devolución de productos · Vuelve la mercadería al depósito/)).toBeInTheDocument()
    const tabla = screen.getByRole('table', { name: 'Nota de crédito 00000002' })
    for (const encabezado of ['Producto', 'Cantidad', 'Precio', 'Importe']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('Transformador Switch')).toBeInTheDocument()
    expect(within(tabla).getByText('-1')).toBeInTheDocument()
    const tarjetaNota = within(screen.getByRole('region', { name: 'Nota de crédito 00000002' }))
    expect(tarjetaNota.getByRole('alert')).toHaveTextContent(/Las cantidades negativas/)
    expect(tarjetaNota.getByRole('alert')).toHaveTextContent(/Vuelve 1 unidad al stock del depósito de origen/)
  })
})

describe('Permisos y empresa activa', () => {
  it('sin permiso no muestra «Anular» ni «Nota de crédito»', async () => {
    detalleActual = { ...DETALLE, puede_anular: false, puede_emitir_nota_credito: false }
    render(arbol())
    expect(await screen.findByRole('heading', { name: 'Factura 00000001' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.detalleAnulacionNotaCredito).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nota de crédito' })).not.toBeInTheDocument()
  })

  it('al cambiar a otra tienda cierra el detalle con aviso y desmonta el diálogo abierto', async () => {
    const { rerender } = render(arbol())
    fireEvent.click(await screen.findByRole('button', { name: 'Nota de crédito' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender(arbol())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos el comprobante/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
