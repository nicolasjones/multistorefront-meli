import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  listarModelos: vi.fn(),
  listarEstados: vi.fn(),
  listarHistorial: vi.fn(),
  listarTecnicos: vi.fn(),
  obtenerReparacion: vi.fn(),
  crearReparacion: vi.fn(),
  actualizarReparacion: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/serviceTecnico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/serviceTecnico')>()),
  listarModelos: mocks.listarModelos,
  listarEstados: mocks.listarEstados,
}))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  listarTecnicos: mocks.listarTecnicos,
  listarHistorial: mocks.listarHistorial,
  obtenerReparacion: mocks.obtenerReparacion,
  crearReparacion: mocks.crearReparacion,
  actualizarReparacion: mocks.actualizarReparacion,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({
  ClienteSelector: (props: {
    valor: { nombre: string } | null
    onCambio: (cliente: { id: string; nombre: string; contacto: string } | null) => void
    error?: string
    onAltaRapida?: () => void
  }) => (
    <div>
      <span data-testid="cliente">{props.valor?.nombre ?? 'sin cliente'}</span>
      <button type="button" onClick={() => props.onCambio({ id: 'c-1', nombre: 'Ana Pérez', contacto: '11 5555-5555' })}>
        Elegir cliente
      </button>
      {props.error ? <span>{props.error}</span> : null}
      {props.onAltaRapida ? <button type="button" onClick={props.onAltaRapida}>Nuevo cliente</button> : null}
    </div>
  ),
}))
vi.mock('../../components/service/AltaRapidaClienteDialog', () => ({
  AltaRapidaClienteDialog: (props: { abierto: boolean; onCreado: (cliente: { id: string; nombre: string; contacto: string }) => void }) =>
    props.abierto ? (
      <div>
        <button type="button" onClick={() => props.onCreado({ id: 'c-2', nombre: 'Cliente Nuevo', contacto: '123' })}>
          Crear rápido
        </button>
      </div>
    ) : null,
}))

import { hoyEnArgentina, type Reparacion } from '../../lib/reparaciones'
import { ServicioReparacion } from './reparacion'

const MODELOS = [
  { id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite', mano_obra_base: 20000, activo: true, updated_at: 't1' },
  { id: 'm-2', equipo: 'PlayStation 4', modelo: 'Slim', mano_obra_base: 26000, activo: false, updated_at: 't2' },
]

const REPARACION: Reparacion = {
  id: 'r-1',
  numero: 1,
  codigo: 'R-0001',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente_id: 'c-1',
  cliente: 'Ana Pérez',
  contacto: '11 5555-5555',
  modelo_id: 'm-1',
  equipo: 'Nintendo Switch',
  modelo: 'Lite',
  estado_id: 's-1',
  estado: 'Recibido',
  estado_cierra: false,
  estado_tono: 'neutral',
  numero_serie: 'SN-1',
  accesorios: 'Cargador',
  falla: 'No enciende',
  puede_ver_costos: true,
  costo_mano_obra: 120,
  costo_repuestos: 30,
  tecnico_id: null,
  ingreso_en: '2026-10-20',
  entrega_prevista: null,
  entrega_real: null,
  entregado_por: null,
  anulada_en: null,
  anulada_motivo: null,
  updated_at: '2026-10-20T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

const abrirNueva = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/nueva']}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/nueva" element={<ServicioReparacion />} />
        <Route path="/service-tecnico/reparaciones/:id" element={<div>Detalle abierto</div>} />
      </Routes>
    </MemoryRouter>,
  )

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
      </Routes>
    </MemoryRouter>,
  )

const elegir = (etiqueta: string, opcion: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: etiqueta }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: opcion }))
}

const guardar = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

describe('Service técnico · Reparación (FR-016, FR-017, FR-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockImplementation((seccion: string) =>
      seccion === 'clientes' ? { nivel: 'edicion', isLoading: false } : { nivel: 'edicion', isLoading: false },
    )
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [
        { id: 'e-1', nombre: 'San Javucho', activa: true },
        { id: 'e-2', nombre: 'Mundo JC', activa: true },
      ],
      empresaActivaId: 'e-2',
      isLoading: false,
      isError: false,
    })
    mocks.listarModelos.mockResolvedValue(MODELOS)
    mocks.listarTecnicos.mockResolvedValue([])
    mocks.listarEstados.mockResolvedValue([])
    mocks.listarHistorial.mockResolvedValue([])
    mocks.obtenerReparacion.mockRejectedValue(new Error('no debería pedirse'))
    mocks.crearReparacion.mockResolvedValue({ ...REPARACION, id: 'r-nueva', codigo: 'R-0002' })
    mocks.actualizarReparacion.mockResolvedValue(REPARACION)
  })

  it('en el alta, la Tienda por defecto es la empresa activa y el ingreso es hoy (no editable)', async () => {
    abrirNueva()
    expect(await screen.findByRole('heading', { name: 'Nueva reparación' })).toBeInTheDocument()
    const activa = screen.getByRole('button', { name: 'Mundo JC' })
    expect(activa).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'false')
    const ingreso = screen.getByLabelText('Ingreso')
    expect(ingreso).toHaveValue(hoyEnArgentina())
    expect(ingreso).toBeDisabled()
  })

  it('valida cliente y modelo obligatorios sin llamar a la base', async () => {
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    guardar()
    expect(await screen.findByText('Elegí el cliente.')).toBeInTheDocument()
    expect(screen.getByText('Elegí el modelo.')).toBeInTheDocument()
    expect(screen.getByText('Elegí la consola o el equipo.')).toBeInTheDocument()
    expect(mocks.crearReparacion).not.toHaveBeenCalled()
  })

  it('con errores avisa «Revisá los campos marcados» y lleva el foco al primer campo inválido', async () => {
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    guardar()
    expect(await screen.findByText('Revisá los campos marcados antes de guardar.')).toBeInTheDocument()
    await waitFor(() => {
      const primero = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      expect(primero).not.toBeNull()
      expect(document.activeElement).toBe(primero)
    })
  })

  it('sin ver_costos no muestra ni envía los costos internos (FR-021)', async () => {
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    expect(screen.queryByLabelText('Costo mano de obra')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Costo repuestos')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Elegir cliente' }))
    elegir('Consola o equipo', 'Nintendo Switch')
    elegir('Modelo', 'Lite')
    guardar()
    await waitFor(() => expect(mocks.crearReparacion).toHaveBeenCalled())
    expect(mocks.crearReparacion.mock.calls[0][0]).not.toHaveProperty('costo_mano_obra', '5')
    expect(mocks.crearReparacion.mock.calls[0][1]).toBe(false)
  })

  it('con ver_costos muestra los costos internos en ARS sin IVA', async () => {
    mocks.usePuedeAccion.mockReturnValue({ puede: true, isLoading: false })
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    expect(screen.getByLabelText('Costo mano de obra')).toBeInTheDocument()
    expect(screen.getByLabelText('Costo repuestos')).toBeInTheDocument()
  })

  it('la alta rápida de cliente deja el cliente elegido en la reparación (FR-015)', async () => {
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    expect(screen.getByTestId('cliente')).toHaveTextContent('sin cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear rápido' }))
    expect(screen.getByTestId('cliente')).toHaveTextContent('Cliente Nuevo')
    expect(screen.getByLabelText('Contacto')).toHaveValue('123')
  })

  it('crea la reparación y lleva al detalle recién creado', async () => {
    abrirNueva()
    await screen.findByRole('heading', { name: 'Nueva reparación' })
    fireEvent.click(screen.getByRole('button', { name: 'Elegir cliente' }))
    elegir('Consola o equipo', 'Nintendo Switch')
    elegir('Modelo', 'Lite')
    fireEvent.change(screen.getByLabelText('Falla informada'), { target: { value: 'No enciende' } })
    guardar()

    await waitFor(() => expect(mocks.crearReparacion).toHaveBeenCalledWith(
      expect.objectContaining({ empresa_id: 'e-2', cliente: expect.objectContaining({ id: 'c-1' }), modelo_id: 'm-1', falla: 'No enciende' }),
      false,
    ))
    expect(await screen.findByText('Detalle abierto')).toBeInTheDocument()
  })

  it('en el detalle precarga los datos y guarda con bloqueo optimista (FR-017)', async () => {
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    abrirDetalle()
    expect(await screen.findByRole('heading', { name: 'Reparación R-0001' })).toBeInTheDocument()
    expect(screen.getByText('Recibido')).toBeInTheDocument()
    expect(screen.getByLabelText('Contacto')).toHaveValue('11 5555-5555')
    expect(screen.getByLabelText('N.º de serie')).toHaveValue('SN-1')
    expect(screen.getByLabelText('Costo mano de obra')).toHaveValue('120')

    fireEvent.change(screen.getByLabelText('Falla informada'), { target: { value: 'Pantalla rota' } })
    guardar()
    await waitFor(() => expect(mocks.actualizarReparacion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r-1', updated_at: REPARACION.updated_at }),
      expect.objectContaining({ falla: 'Pantalla rota' }),
      true,
    ))
    expect(await screen.findByText('Reparación guardada')).toBeInTheDocument()
  })

  it('una edición con datos viejos avisa del conflicto y ofrece recargar (FR-017)', async () => {
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    mocks.actualizarReparacion.mockRejectedValueOnce({ code: '40001' })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })
    guardar()
    expect(await screen.findByText(/Otra persona modificó esta reparación/)).toBeInTheDocument()
    const antes = mocks.obtenerReparacion.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    await waitFor(() => expect(mocks.obtenerReparacion.mock.calls.length).toBe(antes + 1))
  })

  it('con lectura muestra la reparación sin «Guardar»', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByText('Tu rol puede ver esta reparación, no modificarla.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Costo mano de obra')).not.toBeInTheDocument()
  })

  it('una reparación anulada queda marcada y de solo lectura', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-10-21T10:00:00Z', anulada_motivo: 'Cliente desistió' })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })
    expect(screen.getByText('Esta reparación está anulada: solo se puede consultar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Falla informada')).toBeDisabled()
  })

  it('muestra la Entrega real como solo lectura cuando ya se entregó', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, entrega_real: '2026-10-25', entregado_por: 'Ana' })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })
    expect(screen.getByLabelText('Entrega real')).toHaveValue('2026-10-25')
    expect(screen.getByLabelText('Entrega real')).toBeDisabled()
  })

  it('si la reparación no existe o es ajena, muestra error de carga', async () => {
    mocks.obtenerReparacion.mockRejectedValue({ code: 'P0002' })
    abrirDetalle()
    expect(await screen.findByText('Esa reparación no existe o no pertenece a tu organización.')).toBeInTheDocument()
  })

  it('muestra la ganancia estimada junto al costo interno solo con ver_costos (FR-026, FR-027)', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, ganancia_estimada: 1901.3 })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })

    expect(screen.getByText('Costo interno')).toBeInTheDocument()
    expect(screen.getByText('Ganancia estimada')).toBeInTheDocument()
    expect(screen.getByText('$ 1.901,30')).toBeInTheDocument()
  })

  it('sin ver_costos no muestra la ganancia estimada', async () => {
    mocks.obtenerReparacion.mockResolvedValue({
      ...REPARACION, puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null, ganancia_estimada: null,
    })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })

    expect(screen.queryByText('Costo interno')).not.toBeInTheDocument()
    expect(screen.queryByText('Ganancia estimada')).not.toBeInTheDocument()
  })

  it('con lectura los ítems son de solo lectura y no ofrece agregar ni quitar (SC-005)', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerReparacion.mockResolvedValue({
      ...REPARACION,
      puede_ver_costos: false,
      costo_mano_obra: null,
      costo_repuestos: null,
      items: [{
        id: 'i-1', tipo: 'mano_obra', descripcion: 'Cambio de pantalla', producto_id: null, sku: null,
        cantidad: 1, precio_unitario: 1000, subtotal: 1000,
      }],
      total_mano_obra: 1000,
      total_cliente: 1000,
    })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })

    expect(screen.getByText('Los ítems son de solo lectura.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar mano de obra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar repuesto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })

  it('en una reparación entregada los ítems quedan de solo lectura (FR-024)', async () => {
    mocks.obtenerReparacion.mockResolvedValue({
      ...REPARACION,
      estado_cierra: true,
      entrega_real: '2026-10-25',
      entregado_por: 'Ana',
      items: [{
        id: 'i-1', tipo: 'repuesto', descripcion: 'Pantalla Switch', producto_id: null, sku: null,
        cantidad: 1, precio_unitario: 1000, subtotal: 1000,
      }],
      total_repuestos: 1000,
      total_cliente: 1000,
    })
    abrirDetalle()
    await screen.findByRole('heading', { name: 'Reparación R-0001' })

    expect(screen.getByText('Los ítems son de solo lectura.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar mano de obra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar repuesto' })).not.toBeInTheDocument()
  })
})
