import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + tienda + diálogo de alta): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarRma: vi.fn(),
  registrarRma: vi.fn(),
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

import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import { ESTADOS_RMA } from '../../lib/estadoRma'
import { FORMAS_RMA } from '../../lib/formasRma'
import type { RmaListado } from '../../lib/rma'
import { DevolucionesList } from './devoluciones'

const rma = (n: number, extra: Partial<RmaListado> = {}): RmaListado => ({
  id: `r-${n}`, numero: `RMA-009${n}`, creado_en: '2026-10-07T15:00:00+00:00', empresa_id: 'e-1', empresa: 'San Javucho',
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

// Completa el diálogo hasta dejarlo listo para registrar (comprobante, ítem y motivo).
async function completarDialogo() {
  fireEvent.click(screen.getByRole('button', { name: 'Nueva devolución' }))
  const dialogo = await screen.findByRole('dialog', { name: 'Nueva devolución' })
  fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: /Comprobante/ }))
  fireEvent.click(await screen.findByRole('option', { name: /0003-00001231/ }))
  fireEvent.mouseDown(await within(dialogo).findByRole('combobox', { name: /Ítem/ }))
  fireEvent.click(await screen.findByRole('option', { name: /Joystick Pro/ }))
  fireEvent.change(within(dialogo).getByLabelText(/Cantidad/), { target: { value: '2' } })
  fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: 'No enciende' } })
  return dialogo
}

describe('DevolucionesList (F-VTA-28, FR-003…FR-008)', () => {
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
    mocks.registrarRma.mockResolvedValue({ id: 'r-9', numero: 'RMA-0097' })
  })

  it('catálogo único: las cinco formas y los tres estados con su etiqueta y tono del prototipo', () => {
    expect(FORMAS_RMA.map((f) => [f.etiqueta, f.tono])).toEqual([
      ['Cambio directo', 'info'],
      ['Enviado a proveedor', 'primario'],
      ['Faltante en envío', 'aviso'],
      ['Reclamo faltante', 'error'],
      ['Devolución de importe', 'neutral'],
    ])
    expect(ESTADOS_RMA.map((e) => [e.etiqueta, e.tono])).toEqual([
      ['Abierta', 'aviso'],
      ['En gestión', 'info'],
      ['Cerrada', 'exito'],
    ])
  })

  it('muestra título, subtítulo, pestañas, las columnas del prototipo, chips, enlace y el contador', async () => {
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Devoluciones (RMA)', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Devoluciones y reclamos por ítem: cambio, envío a proveedor, faltante en envío y devolución de importe.')).toBeInTheDocument()
    for (const nombre of ['RMA', 'Tienda', 'Comprobante', 'Cliente', 'Producto', 'Forma de RMA', 'Motivo / operador', 'Estado']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.getByText('RMA-0091')).toBeInTheDocument()
    expect(screen.getAllByText('07/10').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '0003-00001231' })).toHaveAttribute('href', '/ventas/comprobantes/c-1')
    expect(screen.getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('Cambio directo', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Devolución de importe', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Abierta', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Cerrada', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('2 devoluciones')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Devoluciones (RMA)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Comprobantes' })).toHaveAttribute('href', '/ventas/comprobantes')
    expect(screen.getByRole('tab', { name: 'Presupuestos' })).toHaveAttribute('href', '/ventas/presupuestos')
  })

  it('pagina en el servidor con «1–8 de N»', async () => {
    mocks.listarRma.mockImplementation(async (_filtros: unknown, pag: number) =>
      pag === 2 ? pagina([rma(5, { cliente: 'Cliente de la página dos' })], 9) : pagina([rma(1)], 9))
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByText('1–8 de 9', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente|Go to next page/i }))
    expect(await screen.findByText('Cliente de la página dos')).toBeInTheDocument()
    expect(mocks.listarRma.mock.calls.at(-1)![1]).toBe(2)
  })

  it('sin devoluciones muestra «Sin devoluciones» con «No hay registros con esa forma de RMA.»', async () => {
    mocks.listarRma.mockResolvedValue(pagina([]))
    abrir()
    expect(await screen.findByText('Sin devoluciones')).toBeInTheDocument()
    expect(screen.getByText('No hay registros con esa forma de RMA.')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error con «Reintentar» y recarga', async () => {
    mocks.listarRma.mockRejectedValueOnce(new Error('boom'))
    abrir()
    expect(await screen.findByText('No pudimos cargar las devoluciones.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
  })

  it('registra una devolución: manda lo elegido, avisa «Devolución registrada · {forma}» y recarga', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const dialogo = await completarDialogo()
    // Solo facturas confirmadas: ni borrador, ni anulada, ni notas se ofrecen (la base valida igual).
    expect(mocks.listarComprobantes).toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('radio', { name: /Enviado a proveedor/ }))
    fireEvent.change(within(dialogo).getByLabelText('Observaciones'), { target: { value: 'Caja abierta' } })
    const llamadasAntes = mocks.listarRma.mock.calls.length
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar devolución' }))
    await waitFor(() => expect(mocks.registrarRma).toHaveBeenCalledWith({
      comprobanteId: 'c-1', lineaId: 'l-1', cantidad: 2, formaRma: 'enviado_a_proveedor', motivo: 'No enciende', observaciones: 'Caja abierta',
    }))
    expect(await screen.findByText('Devolución registrada · Enviado a proveedor')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva devolución' })).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listarRma.mock.calls.length).toBeGreaterThan(llamadasAntes))
  })

  it('el diálogo ofrece solo facturas confirmadas y las cinco formas con su descripción', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva devolución' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva devolución' })
    for (const forma of FORMAS_RMA) {
      expect(within(dialogo).getByRole('radio', { name: new RegExp(forma.etiqueta) })).toBeInTheDocument()
      expect(within(dialogo).getByText(forma.descripcion)).toBeInTheDocument()
    }
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: /Comprobante/ }))
    expect(await screen.findByRole('option', { name: /0003-00001231/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /BORRADOR/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /ANULADA/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /NOTA/ })).not.toBeInTheDocument()
  })

  it('valida antes de enviar: sin comprobante, ítem ni motivo no llama a la base', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva devolución' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva devolución' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar devolución' }))
    expect(await within(dialogo).findByText('Elegí el comprobante.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Elegí el ítem a devolver.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Escribí el motivo de la devolución.')).toBeInTheDocument()
    expect(mocks.registrarRma).not.toHaveBeenCalled()
  })

  it('no deja pedir más de lo vendido en el ítem', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const dialogo = await completarDialogo()
    fireEvent.change(within(dialogo).getByLabelText(/Cantidad/), { target: { value: '4' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar devolución' }))
    expect(await within(dialogo).findByText('No puede superar lo vendido (3).')).toBeInTheDocument()
    expect(mocks.registrarRma).not.toHaveBeenCalled()
  })

  it('si la base rechaza muestra el mensaje claro, no cierra y no avisa éxito', async () => {
    mocks.registrarRma.mockRejectedValue({ code: 'P0001', hint: 'tope', message: 'No podés devolver más de lo vendido: de Joystick Pro quedan 1 por devolver' })
    abrir()
    await screen.findByText('Cliente 1')
    const dialogo = await completarDialogo()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar devolución' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No podés devolver más de lo vendido: de Joystick Pro quedan 1 por devolver')
    expect(screen.getByRole('dialog', { name: 'Nueva devolución' })).toBeInTheDocument()
    expect(screen.queryByText(/Devolución registrada/)).not.toBeInTheDocument()
  })

  it('un error técnico se reemplaza por un mensaje en castellano', async () => {
    mocks.registrarRma.mockRejectedValue({ code: 'XX000', message: 'relation "dominio.rma" does not exist' })
    abrir()
    await screen.findByText('Cliente 1')
    const dialogo = await completarDialogo()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar devolución' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos registrar la devolución. No se guardó nada: probá de nuevo.')
  })

  it('«Cancelar» cierra el diálogo sin registrar', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva devolución' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva devolución' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva devolución' })).not.toBeInTheDocument())
    expect(mocks.registrarRma).not.toHaveBeenCalled()
  })

  it('sin permiso de edición no ofrece «Nueva devolución» pero sí el listado', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('button', { name: 'Nueva devolución' })).not.toBeInTheDocument()
  })

  it('sin acceso a la sección muestra «Acceso restringido» y no monta el listado', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    render(
      <MemoryRouter>
        <RequiereAccesoSeccion seccion="ventas"><DevolucionesList /></RequiereAccesoSeccion>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByRole('heading', { name: 'Devoluciones (RMA)' })).not.toBeInTheDocument()
    expect(mocks.listarRma).not.toHaveBeenCalled()
  })

  it('la tienda usa FiltroEmpresa («Todas las tiendas» + una por empresa) y acota el pedido', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles(null))
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.')).toBeInTheDocument()
    expect(ultimoPedido()).toMatchObject({ empresaId: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2' }))
    expect(mocks.listarRma.mock.calls.at(-1)![1]).toBe(1)
  })

  it('al cambiar la empresa activa de la barra recarga acotado a ella y no deja filas de la anterior', async () => {
    mocks.listarRma.mockImplementation(async ({ empresaId }: { empresaId: string }) =>
      empresaId === 'e-2'
        ? pagina([rma(7, { empresa_id: 'e-2', empresa: 'Mundo JC', cliente: 'Cliente de JC' })])
        : pagina([rma(1)]),
    )
    const vista = abrir()
    await screen.findByText('Cliente 1')

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(arbol())
    expect(await screen.findByText('Cliente de JC')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2' }))
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('al cambiar de empresa con el diálogo abierto lo cierra con aviso y no guarda nada', async () => {
    const vista = abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva devolución' }))
    await screen.findByRole('dialog', { name: 'Nueva devolución' })

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(arbol())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva devolución' })).not.toBeInTheDocument())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos la devolución que estabas cargando/)).toBeInTheDocument()
    expect(mocks.registrarRma).not.toHaveBeenCalled()
  })

  it('en pantallas angostas conserva los datos en tarjetas', async () => {
    mockAnchoPantalla(true)
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Cliente 1').length).toBeGreaterThan(0)
  })

  it('es operable con teclado: el botón y los campos del diálogo reciben foco', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const boton = screen.getByRole('button', { name: 'Nueva devolución' })
    boton.focus()
    expect(boton).toHaveFocus()
    fireEvent.click(boton)
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva devolución' })
    const motivo = within(dialogo).getByLabelText(/Motivo/)
    motivo.focus()
    expect(motivo).toHaveFocus()
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva devolución' })).not.toBeInTheDocument())
  })
})
