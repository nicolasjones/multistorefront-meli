import { MemoryRouter } from 'react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarFiltro, consultasDe, falso, proceso, reiniciarFalso, responderErrores } from './soporteTest'
import type { LlamadaConsulta } from './soporteTest'
import { useState } from 'react'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

// Cada empresa tiene sus procesos; el filtro `empresa_id` decide qué devuelve la «base».
function responderPorEmpresa() {
  falso.respuestas.procesos_masivos = (llamada: LlamadaConsulta) => {
    const empresa = llamada.filtros.find(([columna]) => columna === 'empresa_id')?.[1]
    const filas = empresa === 'e-1'
      ? [proceso(1, { empresa_id: 'e-1', nombre: 'Carga de San Javucho' })]
      : empresa === 'e-2'
        ? [proceso(2, { empresa_id: 'e-2', nombre: 'Carga de Mundo JC' })]
        : [proceso(1, { empresa_id: 'e-1', nombre: 'Carga de San Javucho' }), proceso(3, { nombre: 'Carga de toda la organización' })]
    return { data: filas, count: filas.length, error: null }
  }
}

// Una empresa activa que la prueba puede cambiar «desde la barra superior».
function conActivaCambiante() {
  let cambiarActiva: (id: string | null) => void = () => {}
  falso.filtro.mockImplementation(() => {
    const [activa, setActiva] = useState<string | null>('e-1')
    cambiarActiva = setActiva
    return {
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
      valor: activa,
      cambiar: setActiva,
      empresaActivaId: activa,
      cargando: false,
      hayError: false,
    }
  })
  return (id: string | null) => act(() => cambiarActiva(id))
}

describe('[MSF-354:T012] Empresa activa en el centro de importaciones (FR-015, SC-007)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
    responderPorEmpresa()
  })

  it('con una empresa activa, consulta solo sus procesos', async () => {
    configurarFiltro('e-1')
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    expect(await screen.findByText('Carga de San Javucho')).toBeInTheDocument()
    expect(screen.queryByText('Carga de toda la organización')).not.toBeInTheDocument()
    expect(consultasDe('procesos_masivos')[0].filtros).toContainEqual(['empresa_id', 'e-1'])
  })

  it('en «Todas» muestra también los procesos sin empresa', async () => {
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    expect(await screen.findByText('Carga de toda la organización')).toBeInTheDocument()
    expect(consultasDe('procesos_masivos')[0].filtros).toEqual([])
  })

  it('al cambiar de empresa recarga y nunca muestra procesos de la anterior', async () => {
    const cambiarActiva = conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    expect(await screen.findByText('Carga de San Javucho')).toBeInTheDocument()

    await cambiarActiva('e-2')
    expect(await screen.findByText('Carga de Mundo JC')).toBeInTheDocument()
    expect(screen.queryByText('Carga de San Javucho')).not.toBeInTheDocument()
    expect(consultasDe('procesos_masivos').at(-1)?.filtros).toContainEqual(['empresa_id', 'e-2'])
  })

  it('al cambiar de empresa vuelve a la primera página', async () => {
    falso.respuestas.procesos_masivos = () => ({ data: [proceso(1)], count: 45, error: null })
    const cambiarActiva = conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await screen.findByText('Página 1 de 3')
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    await screen.findByText('Página 2 de 3')

    await cambiarActiva('e-2')
    await screen.findByText('Página 1 de 3')
    expect(consultasDe('procesos_masivos').at(-1)?.rango).toEqual([0, 19])
  })

  it('cierra el diálogo abierto al cambiar de empresa y lo avisa', async () => {
    responderErrores([])
    const cambiarActiva = conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga de San Javucho' }))
    await screen.findByRole('dialog', { name: 'Detalle de la importación' })

    await cambiarActiva('e-2')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/Cambiaste de empresa/)).toBeInTheDocument()
  })

  it('la píldora de la pantalla también reencuadra y recarga', async () => {
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await screen.findByText('Carga de toda la organización')
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(await screen.findByText('Carga de Mundo JC')).toBeInTheDocument()
    expect(screen.queryByText('Carga de toda la organización')).not.toBeInTheDocument()
  })
})
