import { MemoryRouter } from 'react-router'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarFiltro, consultasDe, falso, proceso, reiniciarFalso, responderProcesos } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: () => ({ isSuperadmin: false, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'
import { REFRESCO_PROCESOS_MS } from '../../lib/procesosMasivos'

const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('[MSF-354:T009] Refresco periódico mientras haya procesos abiertos (FR-012)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reiniciarFalso()
    configurarFiltro(null)
  })
  afterEach(() => vi.useRealTimers())

  it('vuelve a consultar sola mientras hay un proceso en curso y muestra el avance nuevo', async () => {
    let procesados = 10
    responderProcesos(() => [proceso(1, { estado: 'en_curso', total: 100, procesados, finalizado_en: null })])
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await avanzar(0)
    expect(screen.getByText('10 de 100')).toBeInTheDocument()

    procesados = 60
    await avanzar(REFRESCO_PROCESOS_MS)
    expect(screen.getByText('60 de 100')).toBeInTheDocument()
    expect(consultasDe('procesos_masivos')).toHaveLength(2)
  })

  it('el refresco no vuelve a mostrar el esqueleto de carga', async () => {
    responderProcesos([proceso(1, { estado: 'pendiente', total: null, procesados: 0, iniciado_en: null, finalizado_en: null })])
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await avanzar(0)
    await avanzar(REFRESCO_PROCESOS_MS - 1)
    await avanzar(1)
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Importaciones y exportaciones' })).toBeInTheDocument()
  })

  it('deja de consultar cuando todos los procesos terminaron', async () => {
    let estado: 'en_curso' | 'completado' = 'en_curso'
    responderProcesos(() => [proceso(1, estado === 'en_curso' ? { estado, procesados: 5, finalizado_en: null } : { estado })])
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await avanzar(0)

    estado = 'completado'
    await avanzar(REFRESCO_PROCESOS_MS)
    expect(screen.getByText('Completado')).toBeInTheDocument()
    const consultas = consultasDe('procesos_masivos').length

    await avanzar(REFRESCO_PROCESOS_MS * 4)
    expect(consultasDe('procesos_masivos')).toHaveLength(consultas)
  })

  it('si no hay procesos abiertos desde el comienzo, no consulta de nuevo', async () => {
    responderProcesos([proceso(1)])
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await avanzar(0)
    await avanzar(REFRESCO_PROCESOS_MS * 3)
    expect(consultasDe('procesos_masivos')).toHaveLength(1)
  })
})
