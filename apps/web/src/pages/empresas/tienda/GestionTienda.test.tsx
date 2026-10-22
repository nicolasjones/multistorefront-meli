import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cambiar: vi.fn(),
  estado: {
    activa: 'e-1',
    warnWhen: false,
    nivel: 'edicion' as 'edicion' | 'lectura' | 'ninguno',
    sinEmpresas: false,
    cargandoEmpresas: false,
    errorEmpresa: false,
  },
}))

vi.mock('@refinedev/core', () => ({
  useWarnAboutChange: () => ({ warnWhen: mocks.estado.warnWhen, setWarnWhen: vi.fn() }),
}))
vi.mock('../../../hooks/useNivelSeccion', () => ({
  useNivelSeccion: () => ({ nivel: mocks.estado.nivel, isLoading: false }),
}))
vi.mock('../../../hooks/useContextoPanel', () => ({
  useContextoPanel: () => ({ contexto: { rol_efectivo: 'administrador' }, isLoading: false, error: null }),
}))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({
    empresas: mocks.estado.sinEmpresas
      ? []
      : [
          { id: 'e-1', nombre: 'Mundo JC', esActiva: mocks.estado.activa === 'e-1', rolId: null },
          { id: 'e-2', nombre: 'San Javucho', esActiva: mocks.estado.activa === 'e-2', rolId: null },
        ],
    empresaActivaId: mocks.estado.sinEmpresas ? null : mocks.estado.activa,
    isLoading: mocks.estado.cargandoEmpresas,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useEmpresaActiva', () => ({
  useEmpresaActiva: () => ({ cambiar: mocks.cambiar, cambiando: false, errorCambio: null, limpiarError: vi.fn() }),
}))
vi.mock('../../../hooks/useEmpresa', () => ({
  useEmpresa: () => ({
    empresa: mocks.estado.errorEmpresa
      ? null
      : mocks.estado.activa === 'e-1'
        ? { id: 'e-1', nombre: 'Mundo JC', activa: true }
        : { id: 'e-2', nombre: 'San Javucho', activa: true },
    isLoading: false,
    isError: mocks.estado.errorEmpresa,
    noEncontrada: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useTiendaDeEmpresa', () => ({
  useTiendaDeEmpresa: () => ({
    tienda: { id: `t-${mocks.estado.activa}`, dominio: mocks.estado.activa === 'e-1' ? 'mundojc.com.ar' : 'sanjavucho.com.ar' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: () => <p>Acceso restringido</p>,
}))

import { violacionesAxe } from '../../../test/axe'
import { GestionTienda } from './GestionTienda'

const abrir = (ruta = '/empresas/e-1/tienda/identidad') =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/empresas/:id/tienda/:pestana" element={<GestionTienda />} />
      </Routes>
    </MemoryRouter>,
  )

describe('GestionTienda (FR-008, FR-009, SC-006, SC-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.estado.activa = 'e-1'
    mocks.estado.warnWhen = false
    mocks.estado.nivel = 'edicion'
    mocks.estado.sinEmpresas = false
    mocks.estado.cargandoEmpresas = false
    mocks.estado.errorEmpresa = false
    mocks.cambiar.mockImplementation(async (id: string) => {
      mocks.estado.activa = id
      return true
    })
  })

  it('muestra el encabezado con empresa, dominio, estado y pestañas', async () => {
    abrir()

    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(screen.getByText('mundojc.com.ar')).toBeInTheDocument()
    expect(screen.getByText('Publicada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Empresas' })).toHaveAttribute('href', '/empresas')
    expect(screen.getByRole('tab', { name: 'Identidad visual' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Contenido' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Catálogo visible' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver la tienda de Mundo JC' })).toHaveAttribute('href', expect.stringMatching(/^http:\/\/mundojc\.com\.ar(:\d+)?\/$/))
  })

  it('«Cambiar a …» cambia la empresa activa y reencuadra la pantalla', async () => {
    abrir()
    await screen.findByRole('heading', { name: 'Mundo JC' })

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a San Javucho' }))

    await waitFor(() => expect(mocks.cambiar).toHaveBeenCalledWith('e-2'))
    expect(await screen.findByRole('heading', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mundo JC' })).not.toBeInTheDocument()
    expect(screen.getByText('sanjavucho.com.ar')).toBeInTheDocument()
  })

  it('sigue a la empresa activa cuando cambia desde la barra superior (sin volver a la ruta vieja)', async () => {
    const { rerender } = abrir()
    await screen.findByRole('heading', { name: 'Mundo JC' })

    // Cambio hecho fuera de esta pantalla (barra superior): la activa pasa a San Javucho
    // mientras la URL todavía apunta a Mundo JC.
    mocks.estado.activa = 'e-2'
    rerender(
      <MemoryRouter initialEntries={['/empresas/e-1/tienda/identidad']}>
        <Routes>
          <Route path="/empresas/:id/tienda/:pestana" element={<GestionTienda />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'San Javucho' })).toBeInTheDocument()
    expect(mocks.cambiar).not.toHaveBeenCalled()
  })

  it('con cambios sin guardar pide confirmación antes de cambiar de empresa', async () => {
    mocks.estado.warnWhen = true
    abrir()
    await screen.findByRole('heading', { name: 'Mundo JC' })

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a San Javucho' }))

    expect(await screen.findByRole('heading', { name: '¿Cambiar de empresa?' })).toBeInTheDocument()
    expect(mocks.cambiar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar igual' }))
    await waitFor(() => expect(mocks.cambiar).toHaveBeenCalledWith('e-2'))
  })

  it('sin edición en Empresas no se accede a la gestión', () => {
    mocks.estado.nivel = 'lectura'
    abrir()

    expect(screen.getByText('Acceso restringido')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mundo JC' })).not.toBeInTheDocument()
  })

  it('muestra el estado vacío cuando no hay empresas', () => {
    mocks.estado.sinEmpresas = true
    abrir()

    expect(screen.getByText('No tenés empresas para gestionar.')).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras resuelve la empresa activa', () => {
    mocks.estado.cargandoEmpresas = true
    abrir()

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('muestra el error con reintento si la empresa no carga', async () => {
    mocks.estado.errorEmpresa = true
    abrir()

    expect(await screen.findByText('No pudimos cargar la tienda de esta empresa.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('no tiene violaciones de axe a %i px', async (ancho) => {
    window.innerWidth = ancho
    const { container } = abrir()
    await screen.findByRole('heading', { name: 'Mundo JC' })

    expect(await violacionesAxe(container)).toEqual([])
  })
})
