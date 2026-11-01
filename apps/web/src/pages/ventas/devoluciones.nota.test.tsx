// [MSF-320:T020] F-VTA-30 (MSF-320, épica MSF-178, FR-023, soporte de SC-005/SC-006): vínculo visible de un RMA resuelto,
// acciones de resolución (emitir nota de crédito / reingresar stock) con y sin permiso, y cambio de empresa. La autoridad
// de la resolución es `vincular_nota_credito_rma` / `reingresar_stock_rma` (pgTAP `rma_nota_stock.test.sql`).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + tienda + diálogos): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarRma: vi.fn(),
  registrarRma: vi.fn(),
  cambiarEstadoRma: vi.fn(),
  vincularNotaCreditoRma: vi.fn(),
  reingresarStockRma: vi.fn(),
  lineasDeComprobante: vi.fn(),
  listarComprobantes: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../../lib/rma', async (importar) => ({
  ...(await importar<typeof import('../../lib/rma')>()),
  listarRma: mocks.listarRma,
  registrarRma: mocks.registrarRma,
  cambiarEstadoRma: mocks.cambiarEstadoRma,
  vincularNotaCreditoRma: mocks.vincularNotaCreditoRma,
  reingresarStockRma: mocks.reingresarStockRma,
  lineasDeComprobante: mocks.lineasDeComprobante,
}))
vi.mock('../../lib/ventasComprobantes', async (importar) => ({
  ...(await importar<typeof import('../../lib/ventasComprobantes')>()),
  listarComprobantes: mocks.listarComprobantes,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['from', 'select', 'eq']) cadena[metodo] = () => cadena
  cadena.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { ...cadena, auth: { getUser: mocks.getUser } } }
})

import type { RmaListado } from '../../lib/rma'
import { DevolucionesList } from './devoluciones'

const rma = (n: number, extra: Partial<RmaListado> = {}): RmaListado => ({
  id: `r-${n}`, actualizado_en: `2026-10-08T10:00:0${n}+00:00`, nota_credito_id: null, nota_credito_numero: null, stock_reingresado: false,
  numero: `RMA-009${n}`, creado_en: '2026-10-07T15:00:00+00:00', empresa_id: 'e-1', empresa: 'San Javucho',
  comprobante_id: `c-${n}`, comprobante_numero: `0003-0000123${n}`, cliente: `Cliente ${n}`, producto: `Joystick ${n}`, cantidad: 3,
  forma_rma: 'cambio_directo', motivo: 'No enciende', operador: 'Javier', estado: 'abierto', ...extra,
})
const pagina = (devoluciones: RmaListado[], total = devoluciones.length) => ({ devoluciones, total })

const empresasAccesibles = (activa: string | null) => ({
  empresas: [
    { id: 'e-1', nombre: 'San Javucho', esActiva: activa === 'e-1', rolId: null },
    { id: 'e-2', nombre: 'Mundo JC', esActiva: activa === 'e-2', rolId: null },
  ],
  empresaActivaId: activa, isLoading: false, isError: false,
})

const arbol = () => (
  <MemoryRouter initialEntries={['/ventas/devoluciones']}>
    <Routes>
      <Route path="/ventas/devoluciones" element={<DevolucionesList />} />
    </Routes>
  </MemoryRouter>
)
const abrir = () => render(arbol())

function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('DevolucionesList · nota de crédito y stock (F-VTA-30, FR-023)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-1'))
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org 1' }, isLoading: false })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'o-1', isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'consulta' }, error: null })
    mocks.listarComprobantes.mockResolvedValue({ comprobantes: [], total: 0 })
    mocks.lineasDeComprobante.mockResolvedValue([])
    mocks.listarRma.mockResolvedValue(pagina([
      rma(1, { forma_rma: 'devolucion_importe' }),
      rma(2, { forma_rma: 'cambio_directo' }),
      rma(3, { forma_rma: 'devolucion_importe', estado: 'cerrado', nota_credito_id: 'n-3', nota_credito_numero: '00000007' }),
      rma(4, { forma_rma: 'faltante_envio', estado: 'cerrado', stock_reingresado: true }),
    ]))
    mocks.vincularNotaCreditoRma.mockResolvedValue({ id: 'r-1', estado: 'cerrado' })
    mocks.reingresarStockRma.mockResolvedValue({ id: 'r-2', estado: 'cerrado' })
  })

  it('un RMA resuelto muestra el vínculo: la nota de crédito asociada (con enlace) y el reingreso de stock', async () => {
    abrir()
    await screen.findByText('Cliente 3')
    const enlace = screen.getByRole('link', { name: 'Nota de crédito 00000007' })
    expect(enlace).toHaveAttribute('href', '/ventas/comprobantes/n-3')
    expect(screen.getAllByText('Stock reingresado')).toHaveLength(1)
    // Los RMA sin resolver no muestran vínculo.
    expect(screen.getAllByRole('link', { name: /Nota de crédito/ })).toHaveLength(1)
  })

  it('ofrece la resolución que corresponde a la forma y no la ofrece a un RMA ya resuelto', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByRole('button', { name: 'Emitir nota de crédito: devolución RMA-0091' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reingresar stock: devolución RMA-0092' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /devolución RMA-0093$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /(Emitir nota|Reingresar stock): devolución RMA-0094/ })).not.toBeInTheDocument()
  })

  it('emite la nota con importe y concepto, avisa y recarga el listado', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const antes = mocks.listarRma.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Emitir nota de crédito: devolución RMA-0091' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Emitir nota de crédito' })
    // Sin datos no llama a la base: muestra los errores de campo.
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Emitir nota de crédito' }))
    expect(await within(dialogo).findByText('Escribí el concepto de la nota de crédito.')).toBeInTheDocument()
    expect(mocks.vincularNotaCreditoRma).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText(/Importe sin IVA/), { target: { value: '150' } })
    fireEvent.change(within(dialogo).getByLabelText(/Concepto/), { target: { value: 'Devolución de importe' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Emitir nota de crédito' }))
    await waitFor(() => expect(mocks.vincularNotaCreditoRma).toHaveBeenCalledWith('r-1', 150, 'Devolución de importe'))
    expect(await screen.findByText('Devolución RMA-0091 · nota de crédito emitida y vinculada')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarRma.mock.calls.length).toBeGreaterThan(antes))
    expect(screen.queryByRole('dialog', { name: 'Emitir nota de crédito' })).not.toBeInTheDocument()
  })

  it('reingresa el stock tras confirmar, avisa y recarga', async () => {
    abrir()
    await screen.findByText('Cliente 2')
    const antes = mocks.listarRma.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Reingresar stock: devolución RMA-0092' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Reingresar stock' })
    expect(mocks.reingresarStockRma).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar stock' }))
    await waitFor(() => expect(mocks.reingresarStockRma).toHaveBeenCalledWith('r-2'))
    expect(await screen.findByText('Devolución RMA-0092 · stock reingresado')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarRma.mock.calls.length).toBeGreaterThan(antes))
  })

  it('si la base rechaza la resolución (p. ej. sin permiso de nota) muestra el mensaje en castellano y deja el diálogo abierto', async () => {
    mocks.vincularNotaCreditoRma.mockRejectedValue({ code: '42501', message: 'Tu rol no puede emitir notas de crédito en esta tienda' })
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Emitir nota de crédito: devolución RMA-0091' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Emitir nota de crédito' })
    fireEvent.change(within(dialogo).getByLabelText(/Importe sin IVA/), { target: { value: '10' } })
    fireEvent.change(within(dialogo).getByLabelText(/Concepto/), { target: { value: 'Devolución' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Emitir nota de crédito' }))
    expect(await within(dialogo).findByText('Tu rol no puede emitir notas de crédito en esta tienda')).toBeInTheDocument()
    expect(screen.queryByText(/nota de crédito emitida y vinculada/)).not.toBeInTheDocument()
  })

  it('un error técnico de la resolución se reemplaza por un mensaje claro', async () => {
    mocks.reingresarStockRma.mockRejectedValue({ code: 'XX000', message: 'relation "dominio.rma" boom' })
    abrir()
    await screen.findByText('Cliente 2')
    fireEvent.click(screen.getByRole('button', { name: 'Reingresar stock: devolución RMA-0092' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Reingresar stock' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar stock' }))
    expect(await within(dialogo).findByText('No pudimos resolver la devolución. No se guardó nada: probá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it('sin permiso de edición ve el vínculo pero no las acciones de resolución', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Cliente 3')
    expect(screen.getByRole('link', { name: 'Nota de crédito 00000007' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Emitir nota de crédito/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reingresar stock/ })).not.toBeInTheDocument()
  })

  it('al cambiar de empresa activa cierra el diálogo de resolución y no deja filas de la anterior', async () => {
    mocks.listarRma.mockImplementation(async ({ empresaId }: { empresaId: string }) =>
      empresaId === 'e-2' ? pagina([rma(7, { empresa_id: 'e-2', empresa: 'Mundo JC', cliente: 'Cliente de JC' })]) : pagina([rma(1, { forma_rma: 'devolucion_importe' })]))
    const vista = abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Emitir nota de crédito: devolución RMA-0091' }))
    await screen.findByRole('dialog', { name: 'Emitir nota de crédito' })

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(arbol())
    expect(await screen.findByText('Cliente de JC')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Emitir nota de crédito' })).not.toBeInTheDocument()
    expect(mocks.vincularNotaCreditoRma).not.toHaveBeenCalled()
  })
})
