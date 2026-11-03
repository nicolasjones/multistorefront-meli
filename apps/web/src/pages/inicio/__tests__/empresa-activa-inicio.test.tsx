import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stock: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicio')>()), leerConteoStock: mocks.stock }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false }) }))
vi.mock('../../../context/PermisosPanel', () => ({ usePermisosPanel: () => ({ permisos: [], isLoading: false, recargar: () => {} }) }))
vi.mock('../useNombrePerfil', () => ({ useNombrePerfil: () => 'Ada' }))
vi.mock('../TarjetaEmpresas', () => ({ TarjetaEmpresas: () => null }))
vi.mock('../TarjetaConsultas', () => ({ TarjetaConsultas: () => null }))
vi.mock('../TarjetaDolar', () => ({ TarjetaDolar: () => null }))
vi.mock('../AccesosDirectos', () => ({ AccesosDirectos: () => null }))

import { notificarEmpresaActivaCambiada } from '../../../lib/empresaActivaRevision'
import { InicioPage } from '..'

describe('Empresa activa en Inicio (FR-010, Principio VIII)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('al cambiar la empresa activa recarga las consultas y no deja el dato anterior', async () => {
    mocks.stock.mockResolvedValueOnce({ sinStock: 5, stockBajo: 0, total: 9 })
    render(<MemoryRouter><InicioPage /></MemoryRouter>)
    expect(await screen.findByText('5 productos sin stock')).toBeInTheDocument()

    mocks.stock.mockReturnValueOnce(new Promise(() => {}))
    act(() => notificarEmpresaActivaCambiada())

    await waitFor(() => expect(mocks.stock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('5 productos sin stock')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })
})
