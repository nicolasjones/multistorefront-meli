import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  cambiar: vi.fn(),
  todas: vi.fn(),
  invalidar: vi.fn(),
  recargar: vi.fn(),
  warnWhen: false,
  invalidate: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ warnWhen: mocks.warnWhen }), useInvalidate: () => mocks.invalidate }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../context/PermisosPanel', () => ({ usePermisosPanel: () => ({ permisos: [], isLoading: false, recargar: mocks.recargar }) }))
vi.mock('../../lib/empresaActiva', () => ({
  listarEmpresasSelector: mocks.listar,
  cambiarEmpresaActiva: mocks.cambiar,
  usarTodasLasEmpresas: mocks.todas,
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
    mocks.todas.mockResolvedValue(undefined)
  })

  it('lista «Todas mis empresas» y las accesibles, con la activa marcada y el rol en cada una', async () => {
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Todas mis empresas')
    expect(items[0]).toHaveTextContent('Varios')
    expect(items[1]).toHaveAttribute('aria-current', 'true')
    expect(items[1]).toHaveTextContent('Operador')
    expect(items[2]).toHaveTextContent('Mundo JC')
    expect(items[2]).toHaveTextContent('Consulta')
  })

  it('elegir «Todas mis empresas» llama a su RPC, invalida la caché de permisos y recarga el panel', async () => {
    mocks.listar
      .mockResolvedValueOnce([sanJavucho, mundoJc])
      .mockResolvedValue([{ ...sanJavucho, esActiva: false }, { ...mundoJc, esActiva: false }])
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Todas mis empresas/ }))

    await waitFor(() => expect(mocks.todas).toHaveBeenCalledTimes(1))
    expect(mocks.cambiar).not.toHaveBeenCalled()
    expect(mocks.invalidar).toHaveBeenCalledTimes(1)
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Empresa activa: Todas mis empresas' })).toBeInTheDocument()
  })

  it('con «Todas» ya elegida no vuelve a llamar a la RPC', async () => {
    mocks.listar.mockResolvedValue([{ ...sanJavucho, esActiva: false }, { ...mundoJc, esActiva: false }])
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: Todas mis empresas' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Todas mis empresas/ }))
    expect(mocks.todas).not.toHaveBeenCalled()
  })

  it('al elegir otra llama a la RPC, invalida la caché de permisos y recarga el panel', async () => {
    mocks.listar.mockResolvedValueOnce([sanJavucho, mundoJc]).mockResolvedValue([{ ...sanJavucho, esActiva: false }, { ...mundoJc, esActiva: true }])
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))

    await waitFor(() => expect(mocks.cambiar).toHaveBeenCalledWith('e-2'))
    expect(mocks.invalidar).toHaveBeenCalledTimes(1)
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(mocks.invalidate).toHaveBeenCalledWith({ resource: 'access', invalidates: ['all'] })
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
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('con una sola empresa es una etiqueta fija, sin menú', async () => {
    mocks.listar.mockResolvedValue([sanJavucho])
    render(<SelectorEmpresaActiva />)
    const etiqueta = await screen.findByRole('group', { name: 'Empresa activa: San Javucho' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(etiqueta)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('el botón expone aria-expanded false/true y el menú tiene nombre accesible', async () => {
    render(<SelectorEmpresaActiva />)
    const boton = await screen.findByRole('button', { name: 'Empresa activa: San Javucho' })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(boton)
    expect(boton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('menu', { name: 'Empresas' })).toBeInTheDocument()
  })

  it('el aviso de error se descarta con su cierre y al reabrir el menú', async () => {
    mocks.cambiar.mockRejectedValue(new Error('x'))
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))
    const alerta = await screen.findByRole('alert')
    fireEvent.click(within(alerta).getByRole('button'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())

    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Empresa activa: San Javucho' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: San Javucho' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('al confirmar el cambio el foco vuelve al botón del selector', async () => {
    mocks.warnWhen = true
    let resolver: () => void = () => {}
    mocks.cambiar.mockReturnValue(new Promise<void>((resolve) => { resolver = resolve }))
    render(<SelectorEmpresaActiva />)
    const boton = await screen.findByRole('button', { name: 'Empresa activa: San Javucho' })
    fireEvent.click(boton)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar igual' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(boton).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(boton).toHaveFocus())
    resolver()
    await waitFor(() => expect(mocks.recargar).toHaveBeenCalled())
  })

  it('«Cambiar igual» se deshabilita mientras se cambia (sin doble llamada)', async () => {
    mocks.warnWhen = true
    let resolver: () => void = () => {}
    mocks.cambiar.mockReturnValue(new Promise<void>((resolve) => { resolver = resolve }))
    render(<SelectorEmpresaActiva />)
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa activa: San Javucho' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mundo JC/ }))
    const confirmar = await screen.findByRole('button', { name: 'Cambiar igual' })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)
    expect(mocks.cambiar).toHaveBeenCalledTimes(1)
    resolver()
    await waitFor(() => expect(mocks.recargar).toHaveBeenCalled())
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
