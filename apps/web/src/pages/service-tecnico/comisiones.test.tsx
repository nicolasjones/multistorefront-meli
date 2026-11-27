import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  listarTecnicos: vi.fn(),
  propsReglas: { current: null as null | { tecnicos: unknown[]; puedeCargar: boolean } },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  listarTecnicos: mocks.listarTecnicos,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
vi.mock('../../components/service/MisComisiones', () => ({ MisComisiones: () => <div>Panel mis comisiones</div> }))
vi.mock('../../components/service/ComisionesEquipo', () => ({ ComisionesEquipo: () => <div>Panel equipo</div> }))
vi.mock('../../components/service/ReglasComision', () => ({
  ReglasComision: (props: { tecnicos: unknown[]; puedeCargar: boolean }) => {
    mocks.propsReglas.current = props
    return <div>Panel reglas</div>
  },
}))

import { ServicioComisiones } from './comisiones'

const montar = ({ nivel = 'edicion', verComisiones = true as boolean | null, cargando = false } = {}) => {
  mocks.useNivelSeccion.mockReturnValue({ nivel: cargando ? null : nivel, isLoading: cargando })
  mocks.usePuedeAccion.mockReturnValue({ puede: verComisiones, isLoading: false })
  return render(<MemoryRouter><ServicioComisiones /></MemoryRouter>)
}

describe('Service técnico · Comisiones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listarTecnicos.mockResolvedValue([{ user_id: 'u-1', nombre: 'Tomás Uno' }])
  })

  it('sin «Ver comisiones» solo ofrece Mis comisiones y no pide los técnicos', () => {
    montar({ verComisiones: false })
    expect(screen.getByText('Panel mis comisiones')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Equipo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Reglas' })).not.toBeInTheDocument()
    expect(mocks.listarTecnicos).not.toHaveBeenCalled()
    expect(mocks.usePuedeAccion).toHaveBeenCalledWith('service_tecnico', 'ver_comisiones')
  })

  it('mientras no se sabe el permiso (null) tampoco muestra lo del equipo', () => {
    montar({ verComisiones: null })
    expect(screen.queryByRole('tab', { name: 'Equipo' })).not.toBeInTheDocument()
    expect(screen.getByText('Panel mis comisiones')).toBeInTheDocument()
  })

  it('«Ver costos» no alcanza: la pantalla solo mira ver_comisiones', () => {
    montar({ verComisiones: false })
    for (const [, accion] of mocks.usePuedeAccion.mock.calls) expect(accion).not.toBe('ver_costos')
  })

  it('con «Ver comisiones» aparecen las tres vistas y se puede pasar de una a otra', async () => {
    montar()
    expect(screen.getByRole('tab', { name: 'Mis comisiones' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }))
    expect(screen.getByText('Panel equipo')).toBeInTheDocument()
    expect(screen.queryByText('Panel mis comisiones')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Reglas' }))
    expect(screen.getByText('Panel reglas')).toBeInTheDocument()
    await waitFor(() => expect(mocks.propsReglas.current?.tecnicos).toEqual([{ user_id: 'u-1', nombre: 'Tomás Uno' }]))
  })

  it('cargar reglas exige edición en Service (con lectura solo las ve)', () => {
    montar({ nivel: 'lectura' })
    fireEvent.click(screen.getByRole('tab', { name: 'Reglas' }))
    expect(mocks.propsReglas.current?.puedeCargar).toBe(false)
  })

  it('si falla la lista de técnicos sigue funcionando con la lista vacía', async () => {
    mocks.listarTecnicos.mockRejectedValue(new Error('x'))
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Reglas' }))
    await waitFor(() => expect(mocks.listarTecnicos).toHaveBeenCalled())
    expect(mocks.propsReglas.current?.tecnicos).toEqual([])
  })

  it('si se pierde el permiso con Equipo abierto, vuelve a Mis comisiones', () => {
    const { rerender } = montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Equipo' }))
    expect(screen.getByText('Panel equipo')).toBeInTheDocument()
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    rerender(<MemoryRouter><ServicioComisiones /></MemoryRouter>)
    expect(screen.getByText('Panel mis comisiones')).toBeInTheDocument()
    expect(screen.queryByText('Panel equipo')).not.toBeInTheDocument()
  })

  it('sin acceso a Service muestra «Acceso restringido»', () => {
    montar({ nivel: 'ninguno' })
    expect(screen.getByText('Acceso restringido a Servicio técnico')).toBeInTheDocument()
    expect(screen.queryByText('Panel mis comisiones')).not.toBeInTheDocument()
  })

  it('mientras carga el nivel no muestra paneles ni acceso restringido', () => {
    montar({ cargando: true })
    expect(screen.queryByText('Panel mis comisiones')).not.toBeInTheDocument()
    expect(screen.queryByText(/Acceso restringido/)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('marca la pestaña Comisiones de Servicio técnico y muestra la organización', () => {
    montar()
    const tab = screen.getByRole('tab', { name: 'Comisiones' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(tab).toHaveAttribute('href', '/service-tecnico/comisiones')
    expect(screen.getByText('Organización: Uno')).toBeInTheDocument()
  })
})
