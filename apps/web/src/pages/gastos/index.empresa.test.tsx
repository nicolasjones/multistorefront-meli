import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Aquí el hook `useGastos` y el filtro por empresa activa corren REALES: solo se simulan la RPC de Supabase y la lista de
// empresas accesibles. Se prueba el cambio de empresa de la barra superior con la lista cargada y con diálogos abiertos.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), useEmpresasAccesibles: vi.fn(), useNivelSeccion: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))

import { Gastos } from './index'

const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho', esActiva: true },
  { id: 'e2', nombre: 'Mundo JC', esActiva: false },
]

const fila = (id: string, empresaId: string, empresaNombre: string, categoria: string, tipo: string, importe: number) => ({
  id, empresa_id: empresaId, empresa_nombre: empresaNombre, fecha: '2026-11-06', categoria, tipo_costo: tipo, detalle: `Detalle ${id}`,
  importe, moneda: 'ARS', cotizacion_usada: null, importe_pesos: importe, recurrente: false, anulado_en: null, motivo_anulacion: null,
  updated_at: '2026-11-06T10:00:00Z',
})
// Datos por empresa (null = todas).
const LISTADO: Record<string, unknown[]> = {
  e1: [fila('g1', 'e1', 'San Javucho', 'Servicios', 'fijo', 36800)],
  e2: [fila('h1', 'e2', 'Mundo JC', 'Alquiler', 'fijo', 90000)],
  todas: [fila('g1', 'e1', 'San Javucho', 'Servicios', 'fijo', 36800), fila('h1', 'e2', 'Mundo JC', 'Alquiler', 'fijo', 90000)],
}
const RESUMEN: Record<string, unknown> = {
  e1: { total: 36800, conteo: 1, conteo_anulados: 0, desglose: [{ categoria: 'Servicios', tipo_costo: 'fijo', total: 36800, conteo: 1 }] },
  e2: { total: 90000, conteo: 1, conteo_anulados: 0, desglose: [{ categoria: 'Alquiler', tipo_costo: 'fijo', total: 90000, conteo: 1 }] },
  todas: { total: 126800, conteo: 2, conteo_anulados: 0, desglose: [
    { categoria: 'Alquiler', tipo_costo: 'fijo', total: 90000, conteo: 1 }, { categoria: 'Servicios', tipo_costo: 'fijo', total: 36800, conteo: 1 }] },
}

const activar = (empresaActivaId: string) => {
  mocks.useEmpresasAccesibles.mockReturnValue({
    empresas: EMPRESAS.map((e) => ({ ...e, esActiva: e.id === empresaActivaId })), empresaActivaId, isLoading: false, isError: false,
  })
}
const vista = () => (
  <MemoryRouter>
    <Gastos />
  </MemoryRouter>
)
const llamadasA = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre).map(([, a]) => a as Record<string, unknown>)

describe('pantalla de gastos: cambio de empresa activa con el hook real', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      const clave = (args.p_empresa as string | null) ?? 'todas'
      if (nombre === 'listar_gastos') return { data: LISTADO[clave] ?? [], error: null }
      if (nombre === 'resumen_gastos') return { data: RESUMEN[clave], error: null }
      return { data: null, error: null }
    })
  })

  it('con la lista cargada y el diálogo «Anular» abierto, cambiar de empresa recarga listado, total y desglose y cierra el diálogo con aviso', async () => {
    activar('e1')
    const { rerender } = render(vista())
    expect(await screen.findByText('Detalle g1')).toBeInTheDocument()
    expect(screen.getByText('$ 36.800,00', { selector: 'p' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Anular gasto de Servicios/ }))
    await screen.findByRole('dialog', { name: 'Anular gasto' })

    activar('e2')
    rerender(vista())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/Cambiaste de empresa: cerramos el diálogo sin guardar nada/)).toBeInTheDocument()
    // Recarga con la empresa nueva: listado, total y desglose son los de Mundo JC, y nada de San Javucho queda visible.
    expect(await screen.findByText('Detalle h1')).toBeInTheDocument()
    expect(screen.queryByText('Detalle g1')).not.toBeInTheDocument()
    expect(screen.getByText('$ 90.000,00', { selector: 'p' })).toBeInTheDocument()
    const desglose = screen.getByRole('list', { name: 'Desglose por concepto' })
    expect(within(desglose).getByText('Alquiler · fijo')).toBeInTheDocument()
    expect(within(desglose).queryByText('Servicios · fijo')).not.toBeInTheDocument()
    expect(llamadasA('listar_gastos').at(-1)).toMatchObject({ p_empresa: 'e2', p_cursor_id: null })
    expect(llamadasA('resumen_gastos').at(-1)).toMatchObject({ p_empresa: 'e2' })
    expect(llamadasA('anular_gasto')).toHaveLength(0)
    expect(mocks.rpc.mock.calls.some(([n]) => n === 'anular_gasto' || n === 'guardar_gasto')).toBe(false)
  })

  it('al volver A, B, A el diálogo viejo no resucita con la fila vieja', async () => {
    activar('e1')
    const { rerender } = render(vista())
    await screen.findByText('Detalle g1')
    fireEvent.click(screen.getByRole('button', { name: /^Anular gasto de Servicios/ }))
    await screen.findByRole('dialog', { name: 'Anular gasto' })

    activar('e2')
    rerender(vista())
    await screen.findByText('Detalle h1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    activar('e1')
    rerender(vista())
    await screen.findByText('Detalle g1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Anular gasto', { selector: 'h2' })).not.toBeInTheDocument()
  })

  it('al cambiar de empresa se vacía la lista vieja mientras llega la nueva y se descarta la tienda elegida a mano', async () => {
    activar('e1')
    const { rerender } = render(vista())
    await screen.findByText('Detalle g1')
    // Elige «Todas las tiendas» a mano: la pantalla lista las dos.
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(await screen.findByText('Detalle h1')).toBeInTheDocument()
    expect(llamadasA('listar_gastos').at(-1)).toMatchObject({ p_empresa: null })

    // La respuesta de la empresa nueva tarda: mientras tanto no queda nada viejo con acciones activas.
    let liberar!: () => void
    const espera = new Promise<void>((res) => { liberar = res })
    mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
      await espera
      const clave = (args.p_empresa as string | null) ?? 'todas'
      return { data: nombre === 'listar_gastos' ? LISTADO[clave] : RESUMEN[clave], error: null }
    })
    activar('e2')
    rerender(vista())
    await waitFor(() => expect(screen.queryByText('Detalle g1')).not.toBeInTheDocument())
    expect(screen.queryByText('Detalle h1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Anular gasto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar gasto/ })).not.toBeInTheDocument()
    liberar()
    expect(await screen.findByText('Detalle h1')).toBeInTheDocument()
    // La selección manual se descartó: el filtro sigue a la empresa activa (Mundo JC), no «Todas».
    expect(screen.queryByText('Detalle g1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
    expect(llamadasA('listar_gastos').at(-1)).toMatchObject({ p_empresa: 'e2' })
  })

  it('el diálogo «Nuevo gasto» abierto también se cierra al cambiar de empresa y no guarda', async () => {
    activar('e1')
    const { rerender } = render(vista())
    await screen.findByText('Detalle g1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    activar('e2')
    rerender(vista())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc.mock.calls.some(([n]) => n === 'guardar_gasto')).toBe(false)
  })
})
