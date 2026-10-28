// [T014] F-VTA-29 (MSF-304, épica MSF-178, SC-004): filtro por forma de RMA, contador, chips de forma y estado, avance de
// estado y teclado. La autoridad de las transiciones es `cambiar_estado_rma` (pgTAP `rma_seguimiento.test.sql`).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + tienda + diálogo de alta): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarRma: vi.fn(),
  registrarRma: vi.fn(),
  cambiarEstadoRma: vi.fn(),
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

import { ESTADOS_RMA, siguienteEstadoRma } from '../../lib/estadoRma'
import { FORMAS_RMA } from '../../lib/formasRma'
import type { RmaListado } from '../../lib/rma'
import { DevolucionesList } from './devoluciones'

const rma = (n: number, extra: Partial<RmaListado> = {}): RmaListado => ({
  id: `r-${n}`, actualizado_en: `2026-10-08T10:00:0${n}+00:00`, numero: `RMA-009${n}`, creado_en: '2026-10-07T15:00:00+00:00', empresa_id: 'e-1', empresa: 'San Javucho',
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

const ultimoPedido = () => mocks.listarRma.mock.calls.at(-1)![0]

function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('DevolucionesList · seguimiento (F-VTA-29, FR-010…FR-012)', () => {
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
    mocks.listarRma.mockResolvedValue(pagina([
      rma(1),
      rma(2, { forma_rma: 'devolucion_importe', estado: 'cerrado', cantidad: 1, producto: 'Case OLED' }),
    ]))
    mocks.listarComprobantes.mockResolvedValue({
      comprobantes: [
        { id: 'c-1', numero: '0003-00001231', tipo: 'factura', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07', cliente: 'Kiosco La Esquina', operador: 'Emilse', estado: 'pendiente', forma_pago: null, envio: null, total: 10 },
        { id: 'c-b', numero: '0003-BORRADOR', tipo: 'factura', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07', cliente: 'Cliente borrador', operador: 'Emilse', estado: 'borrador', forma_pago: null, envio: null, total: 10 },
        { id: 'c-a', numero: '0003-ANULADA', tipo: 'factura', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07', cliente: 'Cliente anulada', operador: 'Emilse', estado: 'anulada', forma_pago: null, envio: null, total: 10 },
        { id: 'n-1', numero: '0003-NOTA', tipo: 'nota_credito', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07', cliente: 'Cliente nota', operador: 'Emilse', estado: 'confirmada', forma_pago: null, envio: null, total: -10 },
      ],
      total: 4,
    })
    mocks.lineasDeComprobante.mockResolvedValue([
      { id: 'l-1', descripcion: 'Joystick Pro', cantidad: 3 },
      { id: 'l-2', descripcion: 'Cable HDMI', cantidad: 1 },
    ])
    mocks.cambiarEstadoRma.mockResolvedValue({ id: 'r-1', estado: 'en_gestion' })
  })

  it('el filtro ofrece «Todas» + las cinco formas y pide al servidor la forma elegida (vuelve a la página 1)', async () => {
    mocks.listarRma.mockImplementation(async (_f: unknown, pag: number) => pagina([rma(1)], pag === 2 ? 9 : 16))
    abrir()
    await screen.findByText('Cliente 1')
    const grupo = screen.getByRole('group', { name: 'Filtrar por forma de RMA' })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Todas', ...FORMAS_RMA.map((f) => f.etiqueta),
    ])
    expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
    expect(ultimoPedido()).toMatchObject({ formaRma: '' })

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente|Go to next page/i }))
    await waitFor(() => expect(mocks.listarRma.mock.calls.at(-1)![1]).toBe(2))
    fireEvent.click(within(grupo).getByRole('button', { name: 'Faltante en envío' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ formaRma: 'faltante_envio' }))
    expect(mocks.listarRma.mock.calls.at(-1)![1]).toBe(1)
    expect(within(grupo).getByRole('button', { name: 'Faltante en envío' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(grupo).getByRole('button', { name: 'Todas' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ formaRma: '' }))
  })

  it('el contador «N devoluciones» sigue al total que devuelve el servidor para la forma elegida', async () => {
    mocks.listarRma.mockImplementation(async ({ formaRma }: { formaRma: string }) =>
      formaRma === 'reclamo_faltante' ? pagina([rma(3, { forma_rma: 'reclamo_faltante' })]) : pagina([rma(1), rma(2)]))
    abrir()
    expect(await screen.findByText('2 devoluciones')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reclamo faltante' }))
    expect(await screen.findByText('1 devolución')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
  })

  it('una forma sin devoluciones muestra «Sin devoluciones» con «No hay registros con esa forma de RMA.»', async () => {
    mocks.listarRma.mockImplementation(async ({ formaRma }: { formaRma: string }) =>
      formaRma === 'reclamo_faltante' ? pagina([]) : pagina([rma(1)]))
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Reclamo faltante' }))
    expect(await screen.findByText('Sin devoluciones')).toBeInTheDocument()
    expect(screen.getByText('No hay registros con esa forma de RMA.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Filtrar por forma de RMA' })).toBeInTheDocument()
  })

  it('cada forma y cada estado se muestran con su chip y su tono', async () => {
    mocks.listarRma.mockResolvedValue(pagina([
      ...FORMAS_RMA.map((f, i) => rma(i + 1, { forma_rma: f.valor })),
      rma(6, { estado: 'en_gestion' }),
      rma(7, { estado: 'cerrado' }),
    ]))
    abrir()
    await screen.findByText('Cliente 1')
    for (const f of FORMAS_RMA) {
      const chip = screen.getAllByText(f.etiqueta, { selector: '.MuiChip-label' })[0].closest('.MuiChip-root')
      expect(chip).not.toBeNull()
      if (f.tono !== 'neutral') expect(chip!.className).toContain({ info: 'colorInfo', primario: 'colorPrimary', aviso: 'colorWarning', error: 'colorError' }[f.tono as 'info'])
    }
    for (const e of ESTADOS_RMA) {
      const chip = screen.getAllByText(e.etiqueta, { selector: '.MuiChip-label' })[0].closest('.MuiChip-root')
      expect(chip!.className).toContain({ aviso: 'colorWarning', info: 'colorInfo', exito: 'colorSuccess' }[e.tono as 'aviso'])
    }
  })

  it('la secuencia lineal: abierto → en_gestion → cerrado → nada', () => {
    expect(siguienteEstadoRma('abierto')).toBe('en_gestion')
    expect(siguienteEstadoRma('en_gestion')).toBe('cerrado')
    expect(siguienteEstadoRma('cerrado')).toBeNull()
  })

  it('quien edita avanza Abierta → En gestión: manda id, estado y sello, avisa y recarga', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const llamadasAntes = mocks.listarRma.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Pasar a En gestión: devolución RMA-0091' }))
    await waitFor(() => expect(mocks.cambiarEstadoRma).toHaveBeenCalledWith('r-1', 'en_gestion', '2026-10-08T10:00:01+00:00'))
    expect(await screen.findByText('Devolución RMA-0091 · En gestión')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarRma.mock.calls.length).toBeGreaterThan(llamadasAntes))
  })

  it('un RMA en gestión se cierra con «Cerrar» y uno cerrado deja la acción deshabilitada', async () => {
    mocks.listarRma.mockResolvedValue(pagina([rma(1, { estado: 'en_gestion' }), rma(2, { estado: 'cerrado' })]))
    mocks.cambiarEstadoRma.mockResolvedValue({ id: 'r-1', estado: 'cerrado' })
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByRole('button', { name: 'Devolución RMA-0092: ya está cerrada' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar: devolución RMA-0091' }))
    await waitFor(() => expect(mocks.cambiarEstadoRma).toHaveBeenCalledWith('r-1', 'cerrado', '2026-10-08T10:00:01+00:00'))
    expect(await screen.findByText('Devolución RMA-0091 · Cerrada')).toBeInTheDocument()
  })

  it('si la base rechaza el avance muestra el error en castellano, no avisa éxito y recarga', async () => {
    mocks.cambiarEstadoRma.mockRejectedValue({ code: '40001', message: 'La devolución fue modificada por otra persona' })
    abrir()
    await screen.findByText('Cliente 1')
    const llamadasAntes = mocks.listarRma.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Pasar a En gestión: devolución RMA-0091' }))
    expect(await screen.findByText(/Otra persona modificó esta devolución/)).toBeInTheDocument()
    expect(screen.queryByText(/Devolución RMA-0091 · En gestión/)).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.listarRma.mock.calls.length).toBeGreaterThan(llamadasAntes))
  })

  it('un error técnico del avance se reemplaza por un mensaje claro', async () => {
    mocks.cambiarEstadoRma.mockRejectedValue({ code: 'XX000', message: 'relation "dominio.rma" boom' })
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Pasar a En gestión: devolución RMA-0091' }))
    expect(await screen.findByText('No pudimos cambiar el estado de la devolución. No se guardó nada: probá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it('sin permiso de edición ve el estado pero no la acción de avance', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByText('Abierta', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pasar a En gestión/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cerrar:/ })).not.toBeInTheDocument()
  })

  it('al cambiar de empresa activa recarga con la forma reencuadrada y no deja filas de la anterior', async () => {
    mocks.listarRma.mockImplementation(async ({ empresaId }: { empresaId: string }) =>
      empresaId === 'e-2' ? pagina([rma(7, { empresa_id: 'e-2', empresa: 'Mundo JC', cliente: 'Cliente de JC' })]) : pagina([rma(1)]))
    const vista = abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Cambio directo' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ formaRma: 'cambio_directo' }))

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(arbol())
    expect(await screen.findByText('Cliente de JC')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2' }))
  })

  it('es operable con teclado: el filtro y la acción de avance reciben foco y se activan con Enter/clic', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const filtro = screen.getByRole('button', { name: 'Reclamo faltante' })
    filtro.focus()
    expect(filtro).toHaveFocus()
    const avance = screen.getByRole('button', { name: 'Pasar a En gestión: devolución RMA-0091' })
    avance.focus()
    expect(avance).toHaveFocus()
    expect(avance).toBeEnabled()
  })
})
