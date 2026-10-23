import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarDepositos: vi.fn(),
  crearDeposito: vi.fn(),
  actualizarDeposito: vi.fn(),
  definirDepositoPorDefecto: vi.fn(),
  cambiarActivoDeposito: vi.fn(),
  puedeEscribir: vi.fn(),
  empresaActiva: vi.fn(),
  useEmpresas: vi.fn(),
}))

vi.mock('../../lib/depositos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/depositos')>()
  return {
    ...actual,
    listarDepositos: mocks.listarDepositos,
    crearDeposito: mocks.crearDeposito,
    actualizarDeposito: mocks.actualizarDeposito,
    definirDepositoPorDefecto: mocks.definirDepositoPorDefecto,
    cambiarActivoDeposito: mocks.cambiarActivoDeposito,
  }
})
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.empresaActiva }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }),
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.puedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { DepositosStock } from './depositos'

const DEPOSITOS = [
  {
    id: 'dep-1',
    nombre: 'Depósito principal',
    direccion: 'Calle 1',
    activo: true,
    por_defecto: true,
    empresas: [{ id: 'emp-1', nombre: 'Tienda Uno' }],
    empresa_ids: ['emp-1'],
    productos_con_stock: 2,
    unidades: 10,
  },
  {
    id: 'dep-2',
    nombre: 'Depósito Sur',
    direccion: null,
    activo: true,
    por_defecto: false,
    empresas: [{ id: 'emp-2', nombre: 'Tienda Dos' }],
    empresa_ids: ['emp-2'],
    productos_con_stock: 0,
    unidades: 0,
  },
]

const EMPRESAS = [
  { id: 'emp-1', nombre: 'Tienda Uno', activa: true },
  { id: 'emp-2', nombre: 'Tienda Dos', activa: true },
]

const abrir = () => render(<MemoryRouter><DepositosStock /></MemoryRouter>)

// ContenidoAdaptable cambia de tabla a tarjetas en xs: se emula el ancho con matchMedia.
function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const abrirDialogo = async (nombre: string) => {
  fireEvent.click(screen.getByRole('button', { name: nombre }))
  return screen.findByRole('dialog')
}

describe('Depósitos de mercadería (F-STK-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnchoPantalla(false)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.empresaActiva.mockReturnValue({ empresaActivaId: null })
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isError: false })
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.listarDepositos.mockResolvedValue(DEPOSITOS)
    mocks.crearDeposito.mockResolvedValue({ id: 'dep-3', nombre: 'Depósito Norte' })
    mocks.actualizarDeposito.mockResolvedValue({ id: 'dep-2', nombre: 'Depósito Sur 2' })
    mocks.definirDepositoPorDefecto.mockResolvedValue({ id: 'dep-2', nombre: 'Depósito Sur' })
    mocks.cambiarActivoDeposito.mockResolvedValue({ id: 'dep-2', nombre: 'Depósito Sur' })
  })

  it('la tabla muestra las 8 columnas del prototipo y la nota al pie', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((celda) => celda.textContent)
    expect(encabezados).toEqual(['Depósito', 'Dirección', 'Venden desde acá', 'Productos con stock', 'Unidades', 'Por defecto', 'Activo', 'Acciones'])
    expect(within(tabla).getByText('Depósito principal')).toBeInTheDocument()
    expect(within(tabla).getByText('Calle 1')).toBeInTheDocument()
    expect(within(tabla).getByText('Tienda Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('10')).toBeInTheDocument()
    expect(screen.getByText(/Un depósito con stock no se puede desactivar/)).toBeInTheDocument()
    expect(mocks.listarDepositos).toHaveBeenCalledWith(null)
  })

  it('filtra por la empresa activa de la barra superior', async () => {
    mocks.empresaActiva.mockReturnValue({ empresaActivaId: 'emp-2' })
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    expect(mocks.listarDepositos).toHaveBeenCalledWith('emp-2')
    expect(screen.getByText(/depósitos desde los que vende la empresa elegida/)).toBeInTheDocument()
  })

  it('al cambiar de empresa recarga, no deja filas de la anterior y cierra el diálogo con aviso', async () => {
    const { rerender } = abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    await abrirDialogo('Nuevo depósito de mercadería')

    let resolver: (valor: unknown) => void = () => undefined
    mocks.listarDepositos.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    mocks.empresaActiva.mockReturnValue({ empresaActivaId: 'emp-2' })
    rerender(<MemoryRouter><DepositosStock /></MemoryRouter>)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Cambiaste de empresa: cerramos el formulario/)).toBeInTheDocument()
    expect(screen.queryByText('Depósito principal')).not.toBeInTheDocument()

    resolver([
      { ...DEPOSITOS[0], id: 'dep-3', nombre: 'Depósito de Tienda Dos', por_defecto: true, empresas: [EMPRESAS[1]], empresa_ids: ['emp-2'] },
    ])
    expect(await screen.findByText('Depósito de Tienda Dos')).toBeInTheDocument()
    expect(screen.queryByText('Depósito principal')).not.toBeInTheDocument()
  })

  it('el Administrador crea un depósito con nombre, dirección y empresas', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const dialogo = await abrirDialogo('Nuevo depósito de mercadería')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Depósito Norte' } })
    fireEvent.change(within(dialogo).getByLabelText(/Dirección/), { target: { value: 'Av. Siempre Viva 742' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Tienda Uno' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear depósito' }))

    await waitFor(() => expect(mocks.crearDeposito).toHaveBeenCalledWith({
      nombre: 'Depósito Norte',
      direccion: 'Av. Siempre Viva 742',
      empresas: ['emp-1'],
    }))
    expect(await screen.findByText('Depósito creado')).toBeInTheDocument()
    expect(mocks.listarDepositos).toHaveBeenCalledTimes(2)
  })

  it('valida el nombre vacío antes de llamar a la base', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const dialogo = await abrirDialogo('Nuevo depósito de mercadería')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear depósito' }))
    expect(await within(dialogo).findByText('Ingresá el nombre del depósito.')).toBeInTheDocument()
    expect(mocks.crearDeposito).not.toHaveBeenCalled()
  })

  it('edita un depósito con el mismo formulario', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const dialogo = await abrirDialogo('Editar Depósito Sur')
    expect(within(dialogo).getByLabelText(/Nombre/)).toHaveValue('Depósito Sur')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Depósito Sur 2' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.actualizarDeposito).toHaveBeenCalledWith('dep-2', {
      nombre: 'Depósito Sur 2',
      direccion: '',
      empresas: ['emp-2'],
    }))
    expect(await screen.findByText('Depósito guardado')).toBeInTheDocument()
  })

  it('«Usar por defecto» muestra el aviso del nuevo depósito por defecto', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    fireEvent.click(screen.getByRole('button', { name: 'Usar Depósito Sur por defecto' }))
    await waitFor(() => expect(mocks.definirDepositoPorDefecto).toHaveBeenCalledWith('dep-2'))
    expect(await screen.findByText('Depósito Sur es ahora el depósito por defecto')).toBeInTheDocument()
  })

  it('el switch «Activo» llama a la RPC y muestra el rechazo con stock', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    mocks.cambiarActivoDeposito.mockRejectedValueOnce(new Error('Tiene stock: trasladá la mercadería antes de desactivarlo'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activo: Depósito Sur' }))
    expect(await screen.findByText('Tiene stock: trasladá la mercadería antes de desactivarlo')).toBeInTheDocument()
    expect(mocks.cambiarActivoDeposito).toHaveBeenCalledWith('dep-2', false)
  })

  it('con lectura ve la tabla completa sin botones de edición', async () => {
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    expect(screen.queryByRole('button', { name: 'Nuevo depósito de mercadería' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /por defecto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByText('Activo', { selector: '.MuiChip-label' })).toHaveLength(2)
  })

  it('el diálogo solo lista empresas activas y avisa si no se pudieron cargar', async () => {
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'Tienda Uno', activa: false }, EMPRESAS[1]],
      isError: true,
    })
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const dialogo = await abrirDialogo('Nuevo depósito de mercadería')
    expect(within(dialogo).queryByRole('checkbox', { name: 'Tienda Uno' })).not.toBeInTheDocument()
    expect(within(dialogo).getByText('No pudimos cargar las empresas. Cerrá y volvé a abrir el diálogo.')).toBeInTheDocument()
  })

  it('un error de carga se avisa y permite reintentar', async () => {
    mocks.listarDepositos.mockRejectedValueOnce(new Error('sin red'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los depósitos.')).toBeInTheDocument()
    expect(screen.queryByText(/sin red/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Depósitos de mercadería' })).toBeInTheDocument()
  })

  it('en 320 px (angosto) muestra tarjetas con los mismos datos y acciones', async () => {
    mockAnchoPantalla(true)
    abrir()
    expect(await screen.findByText('Depósito principal')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Dirección').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Editar Depósito Sur' })).toBeInTheDocument()
  })

  it('el diálogo enfoca Nombre y se cierra con Escape sin guardar', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Depósitos de mercadería' })
    const dialogo = await abrirDialogo('Nuevo depósito de mercadería')
    expect(dialogo).toHaveAttribute('aria-labelledby', 'titulo-deposito')
    expect(within(dialogo).getByLabelText(/Nombre/)).toHaveFocus()
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.crearDeposito).not.toHaveBeenCalled()
  })

  it('la pestaña «Depósitos de mercadería» está activa y la ruta se enlaza', async () => {
    abrir()
    const tab = await screen.findByRole('tab', { name: 'Depósitos de mercadería' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(tab).toHaveAttribute('href', '/stock/depositos')
  })
})
