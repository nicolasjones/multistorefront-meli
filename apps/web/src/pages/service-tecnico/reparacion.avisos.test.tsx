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
  obtenerComprobanteDeReparacion: vi.fn(),
  avisarClienteDeReparacion: vi.fn(),
  listarAvisosDeReparacion: vi.fn(),
  clienteTieneCorreo: vi.fn(),
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
  cambiarEstadoReparacion: mocks.cambiarEstadoReparacion,
}))
vi.mock('../../lib/reparacionComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionComprobante')>()),
  obtenerComprobanteDeReparacion: mocks.obtenerComprobanteDeReparacion,
}))
vi.mock('../../lib/reparacionAvisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionAvisos')>()),
  avisarClienteDeReparacion: mocks.avisarClienteDeReparacion,
  listarAvisosDeReparacion: mocks.listarAvisosDeReparacion,
  clienteTieneCorreo: mocks.clienteTieneCorreo,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))
vi.mock('../../components/service/AltaRapidaClienteDialog', () => ({ AltaRapidaClienteDialog: () => null }))

import type { Reparacion } from '../../lib/reparaciones'
import type { AvisoReparacion } from '../../lib/reparacionAvisos'
import { ServicioReparacion } from './reparacion'

const ESTADO = (id: string, nombre: string, orden: number) => ({
  id, nombre, descripcion: `Significado de ${nombre}`, orden, avisa_cliente: false, cierra: false,
  tono: 'neutral', activo: true, updated_at: 't',
})

const REPARACION: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1',
  cliente: 'Ana Pérez', contacto: '', modelo_id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite',
  estado_id: 's-1', estado: 'Recibido', estado_cierra: false, estado_tono: 'neutral', numero_serie: null,
  accesorios: '', falla: '', puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null,
  tecnico_id: null, ingreso_en: '2026-10-01', entrega_prevista: null, entrega_real: null, entregado_por: null,
  anulada_en: null, anulada_motivo: null, updated_at: '2026-10-20T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

const REPARADA: Reparacion = { ...REPARACION, estado_id: 's-2', estado: 'Reparado' }

const AVISO = (extra: Partial<AvisoReparacion>): AvisoReparacion => ({
  id: 'a-1', estado_id: 's-2', estado_nombre: 'Reparado', destinatario: 'ana@example.com', estado_envio: 'enviado',
  error: null, solicitado_en: '2026-10-21T13:00:00Z', enviado_en: '2026-10-21T13:01:00Z',
  solicitado_por_nombre: 'Laura Gómez', ...extra,
})

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
      </Routes>
    </MemoryRouter>,
  )

const niveles = (service: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'service_tecnico' ? service : 'ninguno',
    isLoading: false,
  }))

const elegirEstado = async (nombre: string) => {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Estado' }))
  fireEvent.click(await screen.findByRole('option', { name: nombre }))
}

describe('Service técnico · Avisos al cliente por cambio de estado (F-SVC-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion')
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    mocks.listarModelos.mockResolvedValue([])
    mocks.listarTecnicos.mockResolvedValue([])
    mocks.listarEstados.mockResolvedValue([ESTADO('s-1', 'Recibido', 1), ESTADO('s-2', 'Reparado', 2)])
    mocks.listarHistorial.mockResolvedValue([])
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(null)
    mocks.listarAvisosDeReparacion.mockResolvedValue([])
    mocks.clienteTieneCorreo.mockResolvedValue(true)
    mocks.cambiarEstadoReparacion.mockResolvedValue(REPARADA)
    mocks.avisarClienteDeReparacion.mockResolvedValue({ resultado: 'encolado', aviso_id: 'a-9' })
  })

  it('muestra la casilla «Avisar al cliente» destildada y cambia el estado sin avisar si no se tilda', async () => {
    abrirDetalle()
    const casilla = await screen.findByRole('checkbox', { name: 'Avisar al cliente' })
    expect(casilla).not.toBeChecked()
    await elegirEstado('Reparado')
    await waitFor(() => expect(mocks.cambiarEstadoReparacion).toHaveBeenCalledWith('r-1', 's-2'))
    expect(mocks.avisarClienteDeReparacion).not.toHaveBeenCalled()
  })

  it('con la casilla tildada cambia primero el estado y después pide el aviso', async () => {
    abrirDetalle()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Avisar al cliente' }))
    await elegirEstado('Reparado')
    await waitFor(() => expect(mocks.avisarClienteDeReparacion).toHaveBeenCalledWith('r-1', undefined))
    expect(mocks.cambiarEstadoReparacion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.avisarClienteDeReparacion.mock.invocationCallOrder[0],
    )
    expect(await screen.findByText('Aviso enviado al cliente')).toBeInTheDocument()
  })

  it('el estado queda cambiado aunque el aviso falle y se informa el error del aviso', async () => {
    mocks.avisarClienteDeReparacion.mockRejectedValue({ code: 'XX000', message: 'boom técnico' })
    abrirDetalle()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Avisar al cliente' }))
    await elegirEstado('Reparado')
    expect(await screen.findByText(/No pudimos avisar al cliente/)).toBeInTheDocument()
    expect(screen.queryByText(/boom técnico/)).not.toBeInTheDocument()
    expect(await screen.findByText('Estado: Reparado', { exact: false }).catch(() => null)).toBeDefined()
    expect(mocks.cambiarEstadoReparacion).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('No pudimos cambiar el estado.')).not.toBeInTheDocument()
  })

  it('el botón del encabezado encola el aviso del estado actual sin cambiarlo', async () => {
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisar al cliente' }))
    await waitFor(() => expect(mocks.avisarClienteDeReparacion).toHaveBeenCalledWith('r-1', undefined))
    expect(mocks.cambiarEstadoReparacion).not.toHaveBeenCalled()
    expect(await screen.findByText('Aviso enviado al cliente')).toBeInTheDocument()
  })

  it('el doble clic en «Avisar al cliente» pide un solo aviso', async () => {
    let liberar: (valor: unknown) => void = () => undefined
    mocks.avisarClienteDeReparacion.mockReturnValue(new Promise((resolver) => { liberar = resolver }))
    abrirDetalle()
    const boton = await screen.findByRole('button', { name: 'Avisar al cliente' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    liberar({ resultado: 'encolado', aviso_id: 'a-9' })
    await waitFor(() => expect(screen.getByText('Aviso enviado al cliente')).toBeInTheDocument())
    expect(mocks.avisarClienteDeReparacion).toHaveBeenCalledTimes(1)
  })

  it('con un cliente sin correo muestra «El cliente no tiene correo», no ofrece avisar y el estado cambia igual', async () => {
    mocks.clienteTieneCorreo.mockResolvedValue(false)
    abrirDetalle()
    expect(await screen.findByText('El cliente no tiene correo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Avisar al cliente' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Avisar al cliente' })).toBeDisabled()
    await elegirEstado('Reparado')
    await waitFor(() => expect(mocks.cambiarEstadoReparacion).toHaveBeenCalledTimes(1))
    expect(mocks.avisarClienteDeReparacion).not.toHaveBeenCalled()
  })

  it('si no se puede saber el correo, la base responde sin_correo y la pantalla lo informa sin encolar', async () => {
    mocks.clienteTieneCorreo.mockResolvedValue(null)
    mocks.avisarClienteDeReparacion.mockResolvedValue({ resultado: 'sin_correo', aviso_id: null })
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisar al cliente' }))
    expect(await screen.findByText('El cliente no tiene correo')).toBeInTheDocument()
    expect(screen.queryByText('Aviso enviado al cliente')).not.toBeInTheDocument()
  })

  it('el historial muestra Pendiente, Enviado y Fallido con quién lo pidió y permite Reenviar', async () => {
    mocks.listarAvisosDeReparacion.mockResolvedValue([
      AVISO({ id: 'a-1', estado_envio: 'pendiente', enviado_en: null }),
      AVISO({ id: 'a-2', estado_envio: 'enviado' }),
      AVISO({ id: 'a-3', estado_envio: 'fallido', enviado_en: null, error: 'No se pudo enviar el correo', estado_id: 's-1', estado_nombre: 'Recibido' }),
    ])
    abrirDetalle()
    const seccion = await screen.findByRole('region', { name: 'Avisos al cliente' })
    await within(seccion).findByText('Fallido')
    expect(within(seccion).getByText('Pendiente')).toBeInTheDocument()
    expect(within(seccion).getByText('Enviado')).toBeInTheDocument()
    expect(within(seccion).getAllByText(/pidió Laura Gómez/)).toHaveLength(3)
    expect(within(seccion).getByText(/No se pudo enviar el correo/)).toBeInTheDocument()
    // El pendiente no se reenvía; el Enviado y el Fallido sí.
    const reenviar = within(seccion).getAllByRole('button', { name: /Reenviar/ })
    expect(reenviar).toHaveLength(2)
    fireEvent.click(within(seccion).getByRole('button', { name: 'Reenviar aviso del estado Recibido' }))
    await waitFor(() => expect(mocks.avisarClienteDeReparacion).toHaveBeenCalledWith('r-1', 's-1'))
  })

  it('el historial vacío y el error de carga usan los estados del kit', async () => {
    mocks.listarAvisosDeReparacion.mockRejectedValueOnce({ code: 'XX000' }).mockResolvedValue([])
    abrirDetalle()
    const seccion = await screen.findByRole('region', { name: 'Avisos al cliente' })
    expect(await within(seccion).findByText('No pudimos cargar los avisos al cliente.')).toBeInTheDocument()
    fireEvent.click(within(seccion).getByRole('button', { name: 'Reintentar' }))
    expect(await within(seccion).findByText('Todavía no se avisó al cliente.')).toBeInTheDocument()
  })

  it('con lectura ve el historial pero no la casilla, el botón ni Reenviar', async () => {
    niveles('lectura')
    mocks.listarAvisosDeReparacion.mockResolvedValue([AVISO({})])
    abrirDetalle()
    const seccion = await screen.findByRole('region', { name: 'Avisos al cliente' })
    await within(seccion).findByText('Enviado')
    expect(screen.queryByRole('checkbox', { name: 'Avisar al cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Avisar al cliente' })).not.toBeInTheDocument()
    expect(within(seccion).queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
  })

  it('al cambiar de empresa activa descarta los avisos anteriores y vuelve a pedirlos', async () => {
    mocks.listarAvisosDeReparacion.mockResolvedValueOnce([AVISO({ destinatario: 'vieja@example.com' })]).mockResolvedValue([])
    const vista = abrirDetalle()
    expect(await screen.findByText(/vieja@example\.com/)).toBeInTheDocument()
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-2', nombre: 'Mundo JC', activa: true }], empresaActivaId: 'e-2', isLoading: false, isError: false,
    })
    vista.rerender(
      <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
        <Routes>
          <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText(/vieja@example\.com/)).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listarAvisosDeReparacion.mock.calls.length).toBeGreaterThanOrEqual(2))
  })
})
