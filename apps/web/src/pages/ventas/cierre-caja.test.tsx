import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useFiltroPorEmpresaActiva: vi.fn(),
  useEsAdministrador: vi.fn(),
  listarCierresCaja: vi.fn(),
  cerrarCaja: vi.fn(),
  reabrirCaja: vi.fn(),
  elegirEmpresa: vi.fn(),
}))

vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: mocks.useEsAdministrador }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/cierreCaja', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/cierreCaja')>()),
  listarCierresCaja: mocks.listarCierresCaja,
  cerrarCaja: mocks.cerrarCaja,
  reabrirCaja: mocks.reabrirCaja,
  mensajeDeErrorCierreCaja: (_e: unknown, porDefecto: string) => porDefecto,
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))

import { CierreCajaList } from './cierre-caja'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', esActiva: true, rolId: 'administrador' },
  { id: 'e-2', nombre: 'Mundo JC', esActiva: false, rolId: 'administrador' },
]

const CIERRE = {
  id: 'k-1',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  fecha: '2027-01-10',
  estado: 'cerrada' as const,
  total: 1500,
  cerrado_por: 'u-1',
  cerrado_en: '2027-01-10T20:00:00+00:00',
  detalle: [
    { forma_pago_id: 'f-1', forma_pago: 'Efectivo', cuenta_cobro_id: null, cuenta_cobro: null, total: 1000 },
    { forma_pago_id: 'f-2', forma_pago: 'Transferencia', cuenta_cobro_id: 'c-1', cuenta_cobro: 'Banco Uno', total: 500 },
  ],
}

function filtro(empresaActivaId: string | null) {
  return {
    empresas: EMPRESAS,
    valor: empresaActivaId,
    cambiar: mocks.elegirEmpresa,
    empresaActivaId,
    cargando: false,
    hayError: false,
  }
}

describe('Cierre de caja (F-VTA-33)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtro('e-1'))
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: true, isLoading: false })
    mocks.listarCierresCaja.mockResolvedValue({ cierres: [CIERRE], total: 1 })
    mocks.cerrarCaja.mockResolvedValue(undefined)
    mocks.reabrirCaja.mockResolvedValue(undefined)
  })

  it('lista los cierres con el detalle por forma de pago y cuenta', async () => {
    render(<CierreCajaList />)
    expect(await screen.findByText('Cerrada')).toBeTruthy()
    expect(screen.getByText(/Efectivo: \$\s*1\.000/)).toBeTruthy()
    expect(screen.getByText(/Transferencia · Banco Uno: \$\s*500/)).toBeTruthy()
    expect(mocks.listarCierresCaja).toHaveBeenCalledWith('e-1', 1, 10)
  })

  it('estado vacío cuando no hay cierres', async () => {
    mocks.listarCierresCaja.mockResolvedValue({ cierres: [], total: 0 })
    render(<CierreCajaList />)
    expect(await screen.findByText('Sin cierres de caja')).toBeTruthy()
  })

  it('error de carga con reintento', async () => {
    mocks.listarCierresCaja.mockRejectedValueOnce(new Error('x'))
    render(<CierreCajaList />)
    expect(await screen.findByText('No pudimos cargar los cierres de caja. Intentá de nuevo.')).toBeTruthy()
  })

  it('«Cerrar caja» confirma y cierra el día de la empresa activa', async () => {
    render(<CierreCajaList />)
    await screen.findByText('Cerrada')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo.textContent).toContain('San Javucho')
    await act(async () => {
      fireEvent.click(Array.from(dialogo.querySelectorAll('button')).find((b) => b.textContent === 'Cerrar caja')!)
    })
    await waitFor(() => expect(mocks.cerrarCaja).toHaveBeenCalledWith('e-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)))
    expect(await screen.findByText(/Caja cerrada · San Javucho/)).toBeTruthy()
  })

  it('«Reabrir» confirma y llama a la RPC con el id del cierre', async () => {
    render(<CierreCajaList />)
    fireEvent.click(await screen.findByRole('button', { name: /Reabrir la caja de San Javucho/ }))
    const dialogo = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(Array.from(dialogo.querySelectorAll('button')).find((b) => b.textContent === 'Reabrir')!)
    })
    await waitFor(() => expect(mocks.reabrirCaja).toHaveBeenCalledWith('k-1'))
  })

  it('el diálogo muestra el error de la base sin cerrarse', async () => {
    mocks.cerrarCaja.mockRejectedValueOnce({ code: '42501' })
    render(<CierreCajaList />)
    await screen.findByText('Cerrada')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    const dialogo = await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(Array.from(dialogo.querySelectorAll('button')).find((b) => b.textContent === 'Cerrar caja')!)
    })
    expect(await screen.findByText('No pudimos cerrar la caja. Intentá de nuevo.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('quien no es administrador no ve «Cerrar caja» ni «Reabrir»', async () => {
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: false, isLoading: false })
    render(<CierreCajaList />)
    await screen.findByText('Cerrada')
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reabrir/ })).toBeNull()
  })

  it('sin empresa activa concreta «Cerrar caja» queda deshabilitado', async () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtro(null))
    render(<CierreCajaList />)
    await screen.findByText('Cerrada')
    expect((screen.getByRole('button', { name: 'Cerrar caja' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('al cambiar de empresa recarga con la nueva y descarta el diálogo abierto (Principio VIII)', async () => {
    const { rerender } = render(<CierreCajaList />)
    await screen.findByText('Cerrada')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar caja' }))
    await screen.findByRole('dialog')
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtro('e-2'))
    rerender(<CierreCajaList />)
    await waitFor(() => expect(mocks.listarCierresCaja).toHaveBeenLastCalledWith('e-2', 1, 10))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
