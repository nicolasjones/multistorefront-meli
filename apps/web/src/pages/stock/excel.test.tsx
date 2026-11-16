import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  schema: vi.fn(),
  depositos: vi.fn(),
  leerPlanilla: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc, from: mocks.from, schema: mocks.schema } }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../lib/depositos', () => ({ listarDepositosActivos: mocks.depositos }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/cargaStock', async (original) => ({
  ...(await original<typeof import('../../lib/cargaStock')>()),
  leerPlanilla: mocks.leerPlanilla,
}))

import { ActualizarStockExcel } from './excel'
import { PestanasStock } from './PestanasStock'

const FILAS = [
  { fila: 2, sku: 'P-1', cantidad: '8', motivo: null },
  { fila: 3, sku: 'NO-EXISTE', cantidad: '1', motivo: null },
]
const VISTA = [
  { fila: 2, sku: 'P-1', producto: 'Producto 1', stock_actual: 5, en_planilla: 8, quedara: 8, diferencia: 3, estado: 'ajuste', mensaje: 'Ajuste' },
  { fila: 3, sku: 'NO-EXISTE', producto: null, stock_actual: null, en_planilla: 1, quedara: null, diferencia: null, estado: 'error', mensaje: 'SKU no existe' },
]

const abrir = () => render(<MemoryRouter><ActualizarStockExcel /></MemoryRouter>)
const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre)

async function elegirPlanilla() {
  const entrada = await screen.findByLabelText('Archivo Excel')
  fireEvent.change(entrada, { target: { files: [new File(['x'], 'stock.xlsx')] } })
  await screen.findByText('2 · Diferencias a aplicar')
}

describe('ActualizarStockExcel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.depositos.mockResolvedValue([{ id: 'd-1', nombre: 'Depósito principal', por_defecto: true }])
    mocks.leerPlanilla.mockResolvedValue({ filas: FILAS })
    mocks.rpc.mockImplementation((nombre: string) => Promise.resolve(
      nombre === 'validar_carga_stock'
        ? { data: VISTA, error: null }
        : { data: { aplicadas: 1, omitidas: 1, repetido: false, detalle: [] }, error: null },
    ))
  })

  it('muestra el formato de la planilla y el depósito predeterminado', async () => {
    abrir()
    expect(await screen.findByText('Formato de la planilla')).toBeInTheDocument()
    expect(screen.getByText('Ningún archivo elegido')).toBeInTheDocument()
    expect(screen.getByText(/no cambian: se ajusta el stock físico/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Depósito de mercadería' })).toHaveTextContent('Depósito principal')
  })

  it('la vista previa mezcla filas válidas y con error, con sus contadores', async () => {
    abrir()
    await elegirPlanilla()
    expect(screen.getByText('2 filas · hoja 1')).toBeInTheDocument()
    expect(screen.getByText('1 cambios')).toBeInTheDocument()
    expect(screen.getByText('1 con error')).toBeInTheDocument()
    expect(screen.getByText('SKU no existe')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar 1 ajustes' })).toBeEnabled()
    expect(llamadas('aplicar_carga_inicial_stock')).toHaveLength(0)
  })

  it('«Aplicar» envía la planilla con la clave y muestra el resultado', async () => {
    abrir()
    await elegirPlanilla()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar 1 ajustes' }))
    expect(await screen.findByText('Stock actualizado.')).toBeInTheDocument()
    expect(screen.getByText(/Se registraron 1 movimientos de ajuste/)).toBeInTheDocument()
    expect(screen.getByText(/Se omitieron 1 fila con error/)).toBeInTheDocument()
    const [, args] = llamadas('aplicar_carga_inicial_stock')[0]
    expect(args).toMatchObject({ p_deposito: 'd-1', p_filas: FILAS })
    expect(typeof args.p_clave).toBe('string')
  })

  it('un doble clic en «Aplicar» envía una sola vez', async () => {
    abrir()
    await elegirPlanilla()
    const boton = screen.getByRole('button', { name: 'Aplicar 1 ajustes' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await screen.findByText('Stock actualizado.')
    expect(llamadas('aplicar_carga_inicial_stock')).toHaveLength(1)
  })

  it('con 0 cambios «Aplicar» queda deshabilitado', async () => {
    mocks.rpc.mockResolvedValue({ data: [VISTA[1]], error: null })
    abrir()
    await elegirPlanilla()
    expect(screen.getByRole('button', { name: 'Aplicar 0 ajustes' })).toBeDisabled()
  })

  it('si falla el servidor muestra el error y permite reintentar con la misma clave', async () => {
    abrir()
    await elegirPlanilla()
    mocks.rpc.mockImplementation((nombre: string) => Promise.resolve(
      nombre === 'aplicar_carga_inicial_stock' ? { data: null, error: new Error('boom') } : { data: VISTA, error: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar 1 ajustes' }))
    expect(await screen.findByText(/No se guardó ningún ajuste/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar 1 ajustes' }))
    await waitFor(() => expect(llamadas('aplicar_carga_inicial_stock')).toHaveLength(2))
    const [primera, segunda] = llamadas('aplicar_carga_inicial_stock')
    expect(segunda[1].p_clave).toBe(primera[1].p_clave)
  })

  it('un archivo rechazado muestra el motivo y no pide vista previa', async () => {
    const { ErrorPlanilla } = await import('../../lib/cargaStock')
    mocks.leerPlanilla.mockRejectedValue(new ErrorPlanilla('Elegí un archivo .xlsx'))
    abrir()
    fireEvent.change(await screen.findByLabelText('Archivo Excel'), { target: { files: [new File(['x'], 'a.csv')] } })
    expect(await screen.findByText('Elegí un archivo .xlsx')).toBeInTheDocument()
    expect(llamadas('validar_carga_stock')).toHaveLength(0)
  })

  it('no consulta nada por empresa (el stock es compartido)', async () => {
    abrir()
    await elegirPlanilla()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.schema).not.toHaveBeenCalled()
  })

  it('con rol de lectura no hay controles ni pestaña', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(await screen.findByText('Tu rol no puede cargar stock por planilla.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Archivo Excel')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Actualizar por Excel' })).not.toBeInTheDocument()
    expect(mocks.depositos).not.toHaveBeenCalled()
  })

  it('con edición la pestaña «Actualizar por Excel» está disponible', () => {
    render(<MemoryRouter><PestanasStock activa="stock" /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Actualizar por Excel' })).toHaveAttribute('href', '/stock/excel')
  })
})
