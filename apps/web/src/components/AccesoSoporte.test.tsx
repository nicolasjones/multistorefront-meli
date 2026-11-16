import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// F-OPS-04 (MSF-300), FR-018: diálogo de motivo, banner con vencimiento y
// limpieza al vencer. Las fechas son relativas al reloj (Date.now()).
const mocks = vi.hoisted(() => ({
  useOrganizacionActiva: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  checkAccesoSoporte: vi.fn(),
  assign: vi.fn(),
}))

vi.mock('../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc, auth: { getUser: mocks.getUser } } }))
vi.mock('../lib/superadmin', async (original) => ({
  ...(await original<typeof import('../lib/superadmin')>()),
  checkAccesoSoporte: mocks.checkAccesoSoporte,
}))

import { DialogoMotivoSoporte } from './DialogoMotivoSoporte'
import { OrganizacionActivaBanner } from './OrganizacionActivaBanner'
import { formatearVencimiento } from '../lib/superadmin'

describe('DialogoMotivoSoporte', () => {
  const onCancelar = vi.fn()
  const onConfirmar = vi.fn()

  function renderizar(props: { error?: string | null; enviando?: boolean } = {}) {
    render(
      <DialogoMotivoSoporte
        organizacionNombre="Acme"
        enviando={props.enviando ?? false}
        error={props.error ?? null}
        onCancelar={onCancelar}
        onConfirmar={onConfirmar}
      />,
    )
  }

  beforeEach(() => vi.clearAllMocks())

  it('no deja ingresar sin motivo y entrega el motivo sin espacios sobrantes', () => {
    renderizar()
    const ingresar = screen.getByRole('button', { name: 'Ingresar' })
    expect(ingresar).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motivo del acceso/), { target: { value: '   ' } })
    expect(ingresar).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motivo del acceso/), { target: { value: '  Revisar reclamo 123  ' } })
    expect(ingresar).toBeEnabled()
    fireEvent.click(ingresar)
    expect(onConfirmar).toHaveBeenCalledWith('Revisar reclamo 123')
  })

  it('muestra el error del servidor y permite cancelar', () => {
    renderizar({ error: 'El motivo del acceso de soporte es obligatorio' })
    expect(screen.getByRole('alert')).toHaveTextContent('El motivo del acceso de soporte es obligatorio')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalled()
  })

  it('mientras ingresa bloquea los botones', () => {
    renderizar({ enviando: true })
    expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })
})

describe('OrganizacionActivaBanner (acceso de soporte)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('location', { ...window.location, assign: mocks.assign })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'org-1', nombre: 'Acme' }, isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.rpc.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('muestra hasta cuándo vale el acceso de soporte', async () => {
    const venceEn = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    mocks.checkAccesoSoporte.mockResolvedValue({ id: 'org-1', nombre: 'Acme', vence_en: venceEn })

    render(<OrganizacionActivaBanner />)

    expect(await screen.findByText(`· Acceso de soporte hasta ${formatearVencimiento(venceEn)}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
  })

  it('al vencer limpia el contexto y vuelve a Organizaciones con aviso', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const venceEn = new Date(Date.now() + 60 * 1000).toISOString()
    mocks.checkAccesoSoporte.mockResolvedValue({ id: 'org-1', nombre: 'Acme', vence_en: venceEn })

    render(<OrganizacionActivaBanner />)
    await screen.findByText('Acceso de soporte hasta', { exact: false })
    expect(mocks.rpc).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(61 * 1000) })

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('salir_de_organizacion'))
    expect(mocks.assign).toHaveBeenCalledWith('/organizaciones?acceso=vencido')
  })

  it('si el acceso ya venció al abrir la app, lo limpia enseguida', async () => {
    mocks.checkAccesoSoporte.mockResolvedValue(null)

    render(<OrganizacionActivaBanner />)

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/organizaciones?acceso=vencido'))
    expect(mocks.rpc).toHaveBeenCalledWith('salir_de_organizacion')
  })

  it('salir a mano vuelve a Organizaciones sin aviso de vencimiento', async () => {
    const venceEn = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mocks.checkAccesoSoporte.mockResolvedValue({ id: 'org-1', nombre: 'Acme', vence_en: venceEn })

    render(<OrganizacionActivaBanner />)
    await screen.findByText('Acceso de soporte hasta', { exact: false })
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/organizaciones'))
  })
})
