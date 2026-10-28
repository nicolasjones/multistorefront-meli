import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  empresas: vi.fn(),
  nivel: vi.fn(),
}))

vi.mock('../../lib/interesWhatsapp', async (original) => ({
  ...(await original<typeof import('../../lib/interesWhatsapp')>()),
  listarInteresWhatsapp: mocks.listar,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.empresas }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.nivel }))

import { BotonInteresWhatsapp, InteresWhatsappDialog } from './InteresWhatsappDialog'

const EMPRESAS = [{ id: 'e1', nombre: 'Tienda Uno', esActiva: false, rolId: null }, { id: 'e2', nombre: 'Tienda Dos', esActiva: false, rolId: null }]
const accesibles = (empresaActivaId: string | null, isLoading = false) => ({
  empresas: isLoading ? [] : EMPRESAS, empresaActivaId, isLoading, isError: false, refetch: vi.fn(),
})

const fila = (producto: string, total: number, empresa = 'Tienda Uno', empresaId = 'e1') => ({
  organizacion_id: 'o1', empresa_id: empresaId, empresa_nombre: empresa, producto_id: `p-${producto}`,
  producto_nombre: producto, sku: `SKU-${producto}`, total, ultimo_interes_at: '2026-10-20T15:00:00Z',
})

describe('InteresWhatsappDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.empresas.mockReturnValue(accesibles('e1'))
    mocks.nivel.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.listar.mockResolvedValue([fila('Alfa', 7), fila('Beta', 2)])
  })

  const abrir = (props: Partial<Parameters<typeof InteresWhatsappDialog>[0]> = {}) =>
    render(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} {...props} />)

  it('lista por producto en el orden recibido, con veces y último interés', async () => {
    abrir()
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
    const filas = screen.getAllByRole('row').slice(1)
    expect(within(filas[0]).getByText('Alfa')).toBeInTheDocument()
    expect(within(filas[0]).getByText('7')).toBeInTheDocument()
    expect(within(filas[0]).getByText('20/10/2026')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Beta')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Veces' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Último interés' })).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledWith('e1')
  })

  it('sin interés muestra el estado vacío con explicación', async () => {
    mocks.listar.mockResolvedValue([])
    abrir()
    expect(await screen.findByText('Todavía no hay interés registrado.')).toBeInTheDocument()
    expect(screen.getByText(/lo vas a ver acá/)).toBeInTheDocument()
  })

  it('ante un error ofrece Reintentar y vuelve a cargar', async () => {
    mocks.listar.mockRejectedValueOnce(new Error('falló'))
    abrir()
    expect(await screen.findByText(/No pudimos cargar el interés por WhatsApp/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledTimes(2)
  })

  it('la columna Tienda solo aparece con «Todas mis empresas»', async () => {
    const { unmount } = abrir()
    await screen.findByText('Alfa')
    expect(screen.queryByRole('columnheader', { name: 'Tienda' })).not.toBeInTheDocument()
    unmount()

    mocks.empresas.mockReturnValue(accesibles(null))
    mocks.listar.mockResolvedValue([fila('Alfa', 3, 'Tienda Dos', 'e2')])
    abrir()
    expect(await screen.findByRole('columnheader', { name: 'Tienda' })).toBeInTheDocument()
    expect(screen.getByText('Tienda Dos')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenLastCalledWith(null)
  })

  it('espera a que se resuelva el selector antes de leer', () => {
    mocks.empresas.mockReturnValue(accesibles(null, true))
    abrir()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('sin empresas accesibles muestra el vacío, no el esqueleto para siempre', async () => {
    mocks.empresas.mockReturnValue({ ...accesibles('e1'), empresas: [] })
    abrir()
    expect(await screen.findByText('Todavía no hay interés registrado.')).toBeInTheDocument()
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('al reabrir tras cambiar de empresa no asoman las filas de la anterior', async () => {
    const { rerender } = abrir()
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
    rerender(<InteresWhatsappDialog abierto={false} onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} />)
    mocks.empresas.mockReturnValue(accesibles('e2'))
    mocks.listar.mockReturnValue(new Promise(() => undefined))
    rerender(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} />)
    expect(screen.queryByText('Alfa')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('al cambiar de empresa con el diálogo abierto avisa para cerrarlo y no pide datos de la nueva', async () => {
    const onEmpresaCambiada = vi.fn()
    const { rerender } = render(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={onEmpresaCambiada} />)
    expect(await screen.findByText('Alfa')).toBeInTheDocument()

    mocks.empresas.mockReturnValue(accesibles('e2'))
    rerender(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={onEmpresaCambiada} />)
    await waitFor(() => expect(onEmpresaCambiada).toHaveBeenCalledTimes(1))
    expect(mocks.listar).toHaveBeenCalledTimes(1)
    expect(mocks.listar).not.toHaveBeenCalledWith('e2')
  })

  it('una respuesta tardía de una lectura vieja no pisa la nueva', async () => {
    let resolverVieja: (filas: unknown[]) => void = () => undefined
    mocks.listar.mockReturnValueOnce(new Promise((resolver) => { resolverVieja = resolver }))
    const { rerender } = render(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} />)
    rerender(<InteresWhatsappDialog abierto={false} onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} />)
    rerender(<InteresWhatsappDialog abierto onCerrar={vi.fn()} onEmpresaCambiada={vi.fn()} />)
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
    resolverVieja([fila('Vieja', 99)])
    await Promise.resolve()
    expect(screen.queryByText('Vieja')).not.toBeInTheDocument()
  })

  it('se cierra con Escape y con el botón Cerrar (teclado)', async () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar })
    await screen.findByText('Alfa')
    expect(screen.getByRole('dialog', { name: 'Interés por WhatsApp' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Interés por WhatsApp' }), { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0])
    expect(onCerrar).toHaveBeenCalledTimes(2)
  })
})

describe('BotonInteresWhatsapp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.empresas.mockReturnValue(accesibles('e1'))
    mocks.listar.mockResolvedValue([fila('Alfa', 7)])
  })

  it.each(['lectura', 'edicion'])('con consultas=%s se ve y abre el diálogo', async (nivel) => {
    mocks.nivel.mockReturnValue({ nivel, isLoading: false })
    render(<BotonInteresWhatsapp />)
    fireEvent.click(screen.getByRole('button', { name: 'Interés por WhatsApp' }))
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
  })

  it.each([['ninguno', false], [null, true], [null, false]])('con consultas=%s (cargando=%s) no se muestra', (nivel, isLoading) => {
    mocks.nivel.mockReturnValue({ nivel, isLoading })
    render(<BotonInteresWhatsapp />)
    expect(screen.queryByRole('button', { name: 'Interés por WhatsApp' })).not.toBeInTheDocument()
  })

  it('al cambiar de empresa con el diálogo abierto lo cierra y muestra el aviso', async () => {
    mocks.nivel.mockReturnValue({ nivel: 'lectura', isLoading: false })
    const { rerender } = render(<BotonInteresWhatsapp />)
    fireEvent.click(screen.getByRole('button', { name: 'Interés por WhatsApp' }))
    await screen.findByText('Alfa')

    mocks.empresas.mockReturnValue(accesibles('e2'))
    rerender(<BotonInteresWhatsapp />)
    expect(await screen.findByText(/Cambiaste de empresa/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Interés por WhatsApp' })).not.toBeInTheDocument())
  })
})
