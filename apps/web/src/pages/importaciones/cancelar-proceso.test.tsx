import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarFiltro, falso, proceso, reiniciarFalso, responderProcesos } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: () => ({ isSuperadmin: false, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

const abrir = () => render(<MemoryRouter><ImportacionesList /></MemoryRouter>)

describe('[MSF-354:T011] Cancelar un proceso (FR-014)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
  })

  it('el botón «Cancelar» solo aparece en procesos abiertos', async () => {
    responderProcesos([
      proceso(1, { estado: 'pendiente', total: null, procesados: 0, finalizado_en: null, iniciado_en: null }),
      proceso(2, { estado: 'en_curso', finalizado_en: null }),
      proceso(3, { estado: 'completado' }),
      proceso(4, { estado: 'fallido' }),
      proceso(5, { estado: 'cancelado' }),
    ])
    abrir()
    await screen.findByRole('table', { name: 'Importaciones y exportaciones' })
    expect(screen.getByRole('button', { name: 'Cancelar Carga 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar Carga 2' })).toBeInTheDocument()
    for (const n of [3, 4, 5]) expect(screen.queryByRole('button', { name: `Cancelar Carga ${n}` })).not.toBeInTheDocument()
  })

  it('pide confirmación y, al confirmar, llama a la función de cancelación y recarga', async () => {
    let estado: 'en_curso' | 'cancelado' = 'en_curso'
    responderProcesos(() => [proceso(1, estado === 'en_curso' ? { estado, finalizado_en: null } : { estado })])
    falso.rpc.mockImplementation(() => {
      estado = 'cancelado'
      return Promise.resolve({ data: 'cancelado', error: null })
    })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Cancelar este proceso?' })
    expect(falso.rpc).not.toHaveBeenCalled()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Sí, cancelar el proceso' }))
    await waitFor(() => expect(falso.rpc).toHaveBeenCalledWith('solicitar_cancelacion_proceso_masivo', { p_proceso_id: 'p-1' }))
    expect(await screen.findByText('Cancelamos el proceso.')).toBeInTheDocument()
    expect(await screen.findByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar Carga 1' })).not.toBeInTheDocument()
  })

  it('«No, volver» no cancela nada', async () => {
    responderProcesos([proceso(1, { estado: 'en_curso', finalizado_en: null })])
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Cancelar este proceso?' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'No, volver' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  it('si el proceso en curso solo queda con cancelación solicitada, lo avisa y muestra «Cancelando»', async () => {
    let solicitada = false
    responderProcesos(() => [proceso(1, { estado: 'en_curso', finalizado_en: null, cancelacion_solicitada: solicitada })])
    falso.rpc.mockImplementation(() => {
      solicitada = true
      return Promise.resolve({ data: 'cancelacion_solicitada', error: null })
    })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar Carga 1' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, cancelar el proceso' }))
    expect(await screen.findByText(/Pedimos cancelar el proceso/)).toBeInTheDocument()
    expect(await screen.findByText('Cancelando')).toBeInTheDocument()
  })

  it('si el proceso ya terminó, el mensaje es claro y se relee la tabla', async () => {
    let terminado = false
    responderProcesos(() => [proceso(1, terminado ? { estado: 'completado' } : { estado: 'en_curso', finalizado_en: null })])
    falso.rpc.mockImplementation(() => {
      terminado = true
      return Promise.resolve({ data: null, error: { message: 'PROCESO_TERMINADO: el proceso ya terminó' } })
    })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Cancelar este proceso?' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Sí, cancelar el proceso' }))
    expect(await within(dialogo).findByText('El proceso ya terminó, no se puede cancelar.')).toBeInTheDocument()
    expect(await screen.findByText('Completado')).toBeInTheDocument()
  })
})
