import { fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, useBlocker, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'

const useContextoPanel = vi.hoisted(() => vi.fn())
const useEmpresas = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas }))

import { SelectorEmpresa } from './SelectorEmpresa'

const contexto = { ...panelFixtures.miembro, organizacion_id: 'org-1', organizacion_nombre: 'Mi organización' }
const sanJavucho = { id: 'e-1', nombre: 'San Javucho', activa: true }
const mundoJc = { id: 'e-2', nombre: 'Mundo JC', activa: true }
const tercera = { id: 'e-3', nombre: 'Tercera', activa: false }

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <p data-testid="ubicacion">{pathname + search}</p>
}

// Simula el UnsavedChangesNotifier de Refine: bloquea toda navegación.
function BloqueoCambiosSinGuardar() {
  const bloqueador = useBlocker(true)
  return bloqueador.state === 'blocked' ? (
    <>
      <button onClick={() => bloqueador.reset()}>Cancelar cambio</button>
      <button onClick={() => bloqueador.proceed()}>Confirmar cambio</button>
    </>
  ) : null
}

const abrir = (ruta: string, extra?: React.ReactNode) => {
  const router = createMemoryRouter(
    [{ path: '*', element: <><SelectorEmpresa /><Ubicacion />{extra}</> }],
    { initialEntries: [ruta] },
  )
  return render(<RouterProvider router={router} />)
}

describe('SelectorEmpresa', () => {
  beforeEach(() => {
    useContextoPanel.mockReturnValue({ contexto, isLoading: false })
    useEmpresas.mockReturnValue({ empresas: [sanJavucho], isLoading: false, isError: false })
  })

  it('con una sola empresa se muestra como etiqueta fija, sin opción de cambio', () => {
    abrir('/empresas/edit/e-1')

    const boton = screen.getByRole('button', { name: 'Empresa activa: San Javucho' })
    expect(boton).not.toHaveAttribute('aria-haspopup')
    fireEvent.click(boton)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('con dos empresas lista ambas y marca la de la ruta', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-2')

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: Mundo JC' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: 'Mundo JC' })).toHaveClass('Mui-selected')
    expect(screen.getByRole('menuitem', { name: 'San Javucho' })).not.toHaveClass('Mui-selected')
  })

  it('con tres empresas las lista todas', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc, tercera], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1')

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('al elegir otra empresa navega a la misma sección con su id', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1')

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mundo JC' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/empresas/edit/e-2')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('elegir la empresa actual no navega', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1')

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'San Javucho' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/empresas/edit/e-1')
  })

  it('con cambios sin guardar la navegación queda bloqueada y cancelar conserva la empresa', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1', <BloqueoCambiosSinGuardar />)

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mundo JC' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/empresas/edit/e-1')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cambio' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/empresas/edit/e-1')
    expect(screen.getByRole('button', { name: 'Empresa activa: San Javucho' })).toBeInTheDocument()
  })

  it('con cambios sin guardar, confirmar el aviso navega a la otra empresa', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1', <BloqueoCambiosSinGuardar />)

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mundo JC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/empresas/edit/e-2')
  })

  it('marca como pausadas las empresas inactivas', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, tercera], isLoading: false, isError: false })
    abrir('/empresas/edit/e-1')

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    expect(screen.getByRole('menuitem', { name: /Tercera/ })).toHaveTextContent('Pausada')
  })

  it('si el id de la ruta no está en el listado cae a la etiqueta de la organización', () => {
    useEmpresas.mockReturnValue({ empresas: [sanJavucho, mundoJc], isLoading: false, isError: false })
    abrir('/empresas/edit/e-9')

    const boton = screen.getByRole('button', { name: 'Empresa activa: Mi organización' })
    expect(boton).not.toHaveAttribute('aria-haspopup')
  })

  it('fuera de una pantalla de empresa el superadmin ve la organización como etiqueta fija y no consulta empresas', () => {
    useContextoPanel.mockReturnValue({ contexto: { ...panelFixtures.superadmin, organizacion_id: 'org-1', organizacion_nombre: 'Mi organización' }, isLoading: false })
    abrir('/clientes')

    const boton = screen.getByRole('button', { name: 'Empresa activa: Mi organización' })
    expect(boton).not.toHaveAttribute('aria-haspopup')
    expect(useEmpresas).toHaveBeenCalledWith({ habilitado: false })
  })

  it('fuera de una pantalla de empresa un usuario común no ve la organización', () => {
    abrir('/clientes')

    expect(screen.queryByRole('button', { name: /Empresa activa/ })).not.toBeInTheDocument()
  })

  it('no renderiza nada sin empresa activa', () => {
    useContextoPanel.mockReturnValue({ contexto: { ...contexto, organizacion_id: null, organizacion_nombre: null }, isLoading: false })
    const { container } = abrir('/clientes')
    expect(container.querySelector('button')).toBeNull()
  })
})
