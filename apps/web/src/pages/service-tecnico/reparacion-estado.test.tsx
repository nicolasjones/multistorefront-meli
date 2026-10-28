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
  cambiarEstadoReparacion: vi.fn(),
  registrarEntregaReparacion: vi.fn(),
  anularReparacion: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
// Avisos al cliente (F-SVC-14): fuera del alcance de este archivo; su historial llega vacío y el cliente con correo.
// El comprobante asociado (F-SVC-13) no es tema de este archivo: sin él la pantalla no suma un segundo «Reintentar».
vi.mock('../../lib/reparacionComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionComprobante')>()),
  obtenerComprobanteDeReparacion: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../lib/reparacionAvisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionAvisos')>()),
  listarAvisosDeReparacion: vi.fn().mockResolvedValue([]),
  clienteTieneCorreo: vi.fn().mockResolvedValue(true),
}))
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
  cambiarEstadoReparacion: mocks.cambiarEstadoReparacion,
  registrarEntregaReparacion: mocks.registrarEntregaReparacion,
  anularReparacion: mocks.anularReparacion,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))
vi.mock('../../components/service/AltaRapidaClienteDialog', () => ({ AltaRapidaClienteDialog: () => null }))

import { hoyEnArgentina, type EventoHistorial, type Reparacion } from '../../lib/reparaciones'
import { ServicioReparacion } from './reparacion'

const ESTADO = (id: string, nombre: string, orden: number, extra: object = {}) => ({
  id, nombre, descripcion: `Significado de ${nombre}`, orden, avisa_cliente: false, cierra: false,
  tono: 'neutral', activo: true, updated_at: 't', ...extra,
})
const ESTADOS = [
  ESTADO('s-1', 'Recibido', 1),
  ESTADO('s-2', 'En diagnóstico', 2),
  ESTADO('s-3', 'Entregado', 3, { cierra: true }),
  ESTADO('s-4', 'Archivado viejo', 4, { activo: false }),
]

const REPARACION: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1',
  cliente: 'Ana Pérez', contacto: '', modelo_id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite',
  estado_id: 's-1', estado: 'Recibido', estado_cierra: false, estado_tono: 'neutral', numero_serie: null,
  accesorios: '', falla: '', puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null,
  tecnico_id: null, ingreso_en: '2026-10-01', entrega_prevista: null, entrega_real: null, entregado_por: null,
  anulada_en: null, anulada_motivo: null, updated_at: '2026-10-20T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

const HISTORIAL: EventoHistorial[] = [
  { id: 'h-2', tipo: 'estado', estado_anterior: 'Recibido', estado_nuevo: 'En diagnóstico', nota: null, usuario: 'Lucía Gómez', creado_en: '2026-10-20T15:00:00Z' },
  { id: 'h-1', tipo: 'alta', estado_anterior: null, estado_nuevo: 'Recibido', nota: null, usuario: 'Lucía Gómez', creado_en: '2026-10-20T10:00:00Z' },
]

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
      </Routes>
    </MemoryRouter>,
  )

const elegirEstado = async (opcion: string) => {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Estado' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: opcion }))
}

describe('Service técnico · Estado, historial, entrega y anulación (FR-030 a FR-034)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    mocks.listarModelos.mockResolvedValue([])
    mocks.listarTecnicos.mockResolvedValue([])
    mocks.listarEstados.mockResolvedValue(ESTADOS)
    mocks.listarHistorial.mockResolvedValue(HISTORIAL)
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
  })

  it('muestra el selector con los estados activos, el «Qué significa» y el historial más reciente primero', async () => {
    abrirDetalle()
    const selector = await screen.findByRole('combobox', { name: 'Estado' })
    expect(await screen.findByText('Significado de Recibido')).toBeInTheDocument()
    fireEvent.mouseDown(selector)
    const opciones = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Recibido', 'En diagnóstico', 'Entregado'])
    // Elegir el estado actual cierra la lista sin llamar a la base (idempotente también en pantalla).
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Recibido' }))
    expect(mocks.cambiarEstadoReparacion).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    const items = within(await screen.findByRole('list', { name: 'Historial de estados' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Recibido → En diagnóstico')
    expect(items[0]).toHaveTextContent('Lucía Gómez')
    expect(items[1]).toHaveTextContent('Ingresó en «Recibido»')
  })

  it('cambia el estado por la RPC, refresca el historial y avisa', async () => {
    mocks.cambiarEstadoReparacion.mockResolvedValue({ ...REPARACION, estado_id: 's-2', estado: 'En diagnóstico', updated_at: 'nuevo' })
    abrirDetalle()
    await elegirEstado('En diagnóstico')
    await waitFor(() => expect(mocks.cambiarEstadoReparacion).toHaveBeenCalledWith('r-1', 's-2'))
    expect(await screen.findByText('Estado cambiado a «En diagnóstico»')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarHistorial).toHaveBeenCalledTimes(2))
  })

  it('un error de la base al cambiar de estado se muestra, no se traga', async () => {
    mocks.cambiarEstadoReparacion.mockRejectedValue({ code: '42501', message: 'x' })
    abrirDetalle()
    await elegirEstado('En diagnóstico')
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
  })

  it('al elegir un estado que cierra abre el diálogo de entrega y no cambia el estado todavía', async () => {
    abrirDetalle()
    await elegirEstado('Entregado')
    const dialogo = await screen.findByRole('dialog', { name: /Entrega · Entregado/ })
    expect(mocks.cambiarEstadoReparacion).not.toHaveBeenCalled()
    expect(within(dialogo).getByLabelText(/Fecha de entrega/)).toHaveValue(hoyEnArgentina())
  })

  it('el diálogo de entrega valida por campo, lleva el foco al primero inválido y no llama a la base', async () => {
    abrirDetalle()
    await elegirEstado('Entregado')
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de entrega/), { target: { value: '2026-09-01' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar entrega' }))
    expect(await within(dialogo).findByText('La entrega no puede ser anterior al ingreso.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Indicá quién retira o recibe el equipo.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(within(dialogo).getByLabelText(/Fecha de entrega/)))
    expect(mocks.registrarEntregaReparacion).not.toHaveBeenCalled()
  })

  it('rechaza una entrega con fecha futura', async () => {
    abrirDetalle()
    await elegirEstado('Entregado')
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Fecha de entrega/), { target: { value: '2999-01-01' } })
    fireEvent.change(within(dialogo).getByLabelText(/Quién entregó/), { target: { value: 'Juan' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar entrega' }))
    expect(await within(dialogo).findByText('La entrega no puede ser una fecha futura.')).toBeInTheDocument()
    expect(mocks.registrarEntregaReparacion).not.toHaveBeenCalled()
  })

  it('registra la entrega, cierra el diálogo y deja la reparación cerrada', async () => {
    mocks.registrarEntregaReparacion.mockResolvedValue({
      ...REPARACION, estado_id: 's-3', estado: 'Entregado', estado_cierra: true, entrega_real: hoyEnArgentina(), entregado_por: 'Juan', updated_at: 'nuevo',
    })
    abrirDetalle()
    await elegirEstado('Entregado')
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Quién entregó/), { target: { value: ' Juan ' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar entrega' }))
    await waitFor(() => expect(mocks.registrarEntregaReparacion).toHaveBeenCalledWith(
      'r-1', 's-3', { entrega_real: hoyEnArgentina(), entregado_por: ' Juan ' },
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Reparación R-0001 entregada')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('La reparación está cerrada: ya no admite cambios de estado.')).toBeInTheDocument()
  })

  it('un error de campo de la base en la entrega se muestra en ese campo', async () => {
    mocks.registrarEntregaReparacion.mockRejectedValue({ code: '22023', hint: 'entregado_por', message: 'Indicá quién retira o recibe el equipo' })
    abrirDetalle()
    await elegirEstado('Entregado')
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Quién entregó/), { target: { value: 'Juan' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar entrega' }))
    expect(await within(dialogo).findByText('Indicá quién retira o recibe el equipo')).toBeInTheDocument()
  })

  it('anular exige motivo, y al anular la reparación queda marcada y de solo lectura', async () => {
    mocks.anularReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-10-20T12:00:00Z', anulada_motivo: 'Cliente desistió', updated_at: 'nuevo' })
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }))
    const dialogo = await screen.findByRole('dialog', { name: /Anular R-0001/ })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anular reparación' }))
    expect(await within(dialogo).findByText('Indicá el motivo de la anulación.')).toBeInTheDocument()
    expect(mocks.anularReparacion).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText(/Motivo de la anulación/), { target: { value: 'Cliente desistió' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anular reparación' }))
    await waitFor(() => expect(mocks.anularReparacion).toHaveBeenCalledWith('r-1', 'Cliente desistió'))
    expect(await screen.findByText('Motivo: Cliente desistió')).toBeInTheDocument()
    expect(screen.getByText('Esta reparación está anulada: solo se puede consultar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Estado' })).not.toBeInTheDocument()
  })

  it('con nivel lectura oculta el selector, «Anular» y «Guardar», pero muestra el estado y el historial', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrirDetalle()
    expect(await screen.findByText('Estado: Recibido')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Estado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Historial de estados' })).toBeInTheDocument()
  })

  it('una reparación anulada se abre de solo lectura, con el motivo', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-10-20T12:00:00Z', anulada_motivo: 'Duplicada' })
    abrirDetalle()
    expect(await screen.findByText('Motivo: Duplicada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Estado' })).not.toBeInTheDocument()
  })

  it('si falla el historial lo avisa sin romper la pantalla', async () => {
    mocks.listarHistorial.mockRejectedValue({ code: 'XX000' })
    abrirDetalle()
    expect(await screen.findByText('No pudimos cargar el historial de estados.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeInTheDocument()
  })

  it('si falla el historial ofrece «Reintentar» junto al error y lo recarga', async () => {
    mocks.listarHistorial.mockRejectedValueOnce({ code: 'XX000' })
    abrirDetalle()
    expect(await screen.findByText('No pudimos cargar el historial de estados.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('list', { name: 'Historial de estados' })).toBeInTheDocument()
    expect(screen.queryByText('No pudimos cargar el historial de estados.')).not.toBeInTheDocument()
  })

  it('si solo cambió el estado, muestra el éxito sin avisos de otra edición', async () => {
    mocks.cambiarEstadoReparacion.mockResolvedValue({ ...REPARACION, estado_id: 's-2', estado: 'En diagnóstico', updated_at: 'nuevo' })
    abrirDetalle()
    await elegirEstado('En diagnóstico')
    expect(await screen.findByText('Estado cambiado a «En diagnóstico»')).toBeInTheDocument()
  })

  it('si otra persona editó los datos y el formulario está intacto, lo recarga y lo avisa', async () => {
    mocks.cambiarEstadoReparacion.mockResolvedValue({
      ...REPARACION, estado_id: 's-2', estado: 'En diagnóstico', falla: 'No enciende', updated_at: 'nuevo',
    })
    abrirDetalle()
    await elegirEstado('En diagnóstico')
    expect(await screen.findByText(/Otra persona modificó los datos y los actualizamos/)).toBeInTheDocument()
    expect(screen.getByLabelText('Falla informada')).toHaveValue('No enciende')
  })

  it('si otra persona editó los datos y hay ediciones sin guardar, conserva lo escrito y avisa del conflicto', async () => {
    mocks.cambiarEstadoReparacion.mockResolvedValue({
      ...REPARACION, estado_id: 's-2', estado: 'En diagnóstico', falla: 'No enciende', updated_at: 'nuevo',
    })
    abrirDetalle()
    fireEvent.change(await screen.findByLabelText('Accesorios recibidos'), { target: { value: 'Cargador' } })
    await elegirEstado('En diagnóstico')
    expect(await screen.findByText(/al guardar te vamos a avisar del conflicto/)).toBeInTheDocument()
    expect(screen.getByLabelText('Accesorios recibidos')).toHaveValue('Cargador')
    expect(screen.getByLabelText('Falla informada')).toHaveValue('')
  })
})
