import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILTROS_ACTIVIDAD_INICIALES } from '../../lib/actividad'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  useExportarActividad: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useExportarActividad', () => ({ useExportarActividad: mocks.useExportarActividad }))

import { BotonExportarActividad } from './BotonExportarActividad'

const nivel = (valor: string | null) => ({ nivel: valor, isLoading: false, error: false })
const accion = (puede: boolean | null) => ({ puede, isLoading: puede === null })
const abrir = () => render(<BotonExportarActividad filtros={FILTROS_ACTIVIDAD_INICIALES} />)

describe('BotonExportarActividad (F-AUD-03, FR-010, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useExportarActividad.mockReturnValue({ exportar: vi.fn(), exportando: false, mensaje: null, cerrarMensaje: vi.fn() })
  })

  it('lo ve quien tiene edición en Actividad y la acción exportar', () => {
    mocks.useNivelSeccion.mockReturnValue(nivel('edicion'))
    mocks.usePuedeAccion.mockReturnValue(accion(true))
    abrir()
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument()
  })

  it('un Operador de solo lectura no lo ve aunque tenga la acción exportar (CA-AUD-03-2)', () => {
    mocks.useNivelSeccion.mockReturnValue(nivel('lectura'))
    mocks.usePuedeAccion.mockReturnValue(accion(true))
    abrir()
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('sin la acción exportar no hay botón, ni con edición', () => {
    mocks.useNivelSeccion.mockReturnValue(nivel('edicion'))
    mocks.usePuedeAccion.mockReturnValue(accion(false))
    abrir()
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('mientras no se sabe el permiso no se muestra', () => {
    mocks.useNivelSeccion.mockReturnValue(nivel(null))
    mocks.usePuedeAccion.mockReturnValue(accion(null))
    abrir()
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('muestra «Exportando…» y lo deshabilita mientras corre', () => {
    mocks.useNivelSeccion.mockReturnValue(nivel('edicion'))
    mocks.usePuedeAccion.mockReturnValue(accion(true))
    mocks.useExportarActividad.mockReturnValue({ exportar: vi.fn(), exportando: true, mensaje: null, cerrarMensaje: vi.fn() })
    abrir()
    expect(screen.getByRole('button', { name: 'Exportando…' })).toBeDisabled()
  })
})
