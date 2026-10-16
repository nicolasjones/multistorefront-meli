import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  cambiar: vi.fn(),
  invalidar: vi.fn(),
  recargar: vi.fn(),
  warnWhen: false,
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ warnWhen: mocks.warnWhen }) }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../context/PermisosPanel', () => ({ usePermisosPanel: () => ({ permisos: [], isLoading: false, recargar: mocks.recargar }) }))
vi.mock('../../lib/empresaActiva', () => ({
  listarEmpresasSelector: mocks.listar,
  cambiarEmpresaActiva: mocks.cambiar,
}))
vi.mock('../../lib/permisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/permisos')>()),
  invalidarCachePermisos: mocks.invalidar,
}))

import { SelectorEmpresaActiva } from './SelectorEmpresaActiva'

const sanJavucho = { id: 'e-1', nombre: 'San Javucho', esActiva: true, rolId: 'operador' }
const mundoJc = { id: 'e-2', nombre: 'Mundo JC', esActiva: false, rolId: 'consulta' }

describe('SelectorEmpresaActiva (F-ROL-06)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.warnWhen = false
    mocks.listar.mockResolvedValue([sanJavucho, mundoJc])
    mocks.cambiar.mockResolvedValue(undefined)
  })

  it('lista solo las empresas accesibles con la activa marcada y el rol en cada una', async () => {
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('aria-current', 'true')
    expect(items[0]).toHaveTextContent('Operador')
    expect(items[1]).toHaveTextContent('Mundo JC')
    expect(items[1]).toHaveTextContent('Consulta')
  })

  it('al elegir otra llama a la RPC, invalida la caché de permisos y recarga el panel', async () => {
    mocks.listar.mockResolvedValueOnce([sanJavucho, mundoJc]).mockResolvedValue([{ ...sanJavucho, esActiva: false }, { ...mundoJc, esActiva: true }])
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))

    await waitFor(() => expect(mocks.cambiar).toHaveBeenCalledWith('e-2'))
    expect(mocks.invalidar).toHaveBeenCalledTimes(1)
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Empresa activa: Mundo JC' })).toBeInTheDocument()
  })

  it('elegir la empresa que ya está activa no llama a la RPC', async () => {
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /San Javucho/ }))
    expect(mocks.cambiar).not.toHaveBeenCalled()
  })

  it('con cambios sin guardar pide confirmación; cancelar no cambia nada', async () => {
    mocks.warnWhen = true
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))

    expect(await screen.findByRole('dialog', { name: '¿Cambiar de empresa?' })).toBeInTheDocument()
    expect(mocks.cambiar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir acá' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.cambiar).not.toHaveBeenCalled()
    expect(mocks.invalidar).not.toHaveBeenCalled()
  })

  it('con cambios sin guardar, confirmar cambia la empresa', async () => {
    mocks.warnWhen = true
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar igual' }))

    await waitFor(() => expect(mocks.cambiar).toHaveBeenCalledWith('e-2'))
    expect(mocks.invalidar).toHaveBeenCalledTimes(1)
  })

  it('si la RPC falla avisa y no invalida ni recarga permisos', async () => {
    mocks.cambiar.mockRejectedValue(new Error('No tenés acceso a esa empresa'))
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cambiar la empresa')
    expect(mocks.invalidar).not.toHaveBeenCalled()
    expect(mocks.recargar).not.toHaveBeenCalled()
  })

  it('con una sola empresa es una etiqueta fija, sin menú', async () => {
    mocks.listar.mockResolvedValue([sanJavucho])
    render(<SelectorEmpresaActiva />)
    const etiqueta = await screen.findByRole('button', { name: 'Empresa activa: San Javucho' })
    expect(etiqueta).not.toHaveAttribute('aria-haspopup')
    fireEvent.click(etiqueta)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('sin empresas accesibles no muestra nada', async () => {
    mocks.listar.mockResolvedValue([])
    const { container } = render(<SelectorEmpresaActiva />)
    await waitFor(() => expect(mocks.listar).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('si la carga falla ofrece reintentar', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listar.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([sanJavucho, mundoJc])
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' })).toBeInTheDocument()
    log.mockRestore()
  })
})
