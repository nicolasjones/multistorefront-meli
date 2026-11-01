import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lectura: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.lectura }) }),
      }),
    }),
    rpc: (...argumentos: unknown[]) => mocks.rpc(...argumentos),
  },
}))

import { CorreoAvisosConsultas } from './CorreoAvisosConsultas'

const CONTACTO = 'contacto@tienda.example'

const abrir = (soloLectura = false) =>
  render(<CorreoAvisosConsultas empresaId="e-1" correoContacto={CONTACTO} soloLectura={soloLectura} />)

describe('CorreoAvisosConsultas (F-CON-03, FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lectura.mockResolvedValue({ data: null, error: null })
    mocks.rpc.mockResolvedValue({ data: '2026-10-23T12:00:00Z', error: null })
  })

  it('sin dirección propia muestra el correo de contacto como valor inicial', async () => {
    abrir()
    await waitFor(() => expect(screen.getByLabelText('Correo para avisos de consultas')).toHaveValue(CONTACTO))
    expect(mocks.lectura).toHaveBeenCalledTimes(1)
  })

  it('advierte que la dirección ya no se usa para los avisos nuevos', async () => {
    abrir()
    expect(
      await screen.findByText(/Esta dirección ya no se usa para las consultas nuevas/),
    ).toBeInTheDocument()
  })

  it('si la empresa ya tiene dirección propia, muestra esa y no el contacto', async () => {
    mocks.lectura.mockResolvedValue({
      data: { correo_avisos: 'avisos@tienda.example', updated_at: '2026-10-20T09:00:00Z' },
      error: null,
    })
    abrir()
    await waitFor(() => expect(screen.getByLabelText('Correo para avisos de consultas')).toHaveValue('avisos@tienda.example'))
  })

  it('valida el formato antes de llamar a la RPC', async () => {
    abrir()
    const campo = await screen.findByLabelText('Correo para avisos de consultas')
    fireEvent.change(campo, { target: { value: 'sin-arroba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección de avisos' }))

    expect(await screen.findByText('Ingresá un correo con formato válido.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('guarda la dirección propia con la RPC y avisa el éxito', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Correo para avisos de consultas'), {
      target: { value: 'avisos@tienda.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección de avisos' }))

    expect(await screen.findByText('Dirección de avisos guardada.')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_correo_avisos_consultas', {
      p_empresa_id: 'e-1',
      p_correo: 'avisos@tienda.example',
      p_updated_at: null,
    })
  })

  it('dejar el contacto (o vaciarlo) guarda null para seguir al correo de contacto', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar dirección de avisos' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_correo: null })
    expect(await screen.findByText('Dirección de avisos guardada.')).toBeInTheDocument()
    expect(screen.getByLabelText('Correo para avisos de consultas')).toHaveValue(CONTACTO)
  })

  it('un conflicto de edición se explica y no se presenta como guardado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'conflicto' } })
    abrir()
    fireEvent.change(await screen.findByLabelText('Correo para avisos de consultas'), {
      target: { value: 'avisos@tienda.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección de avisos' }))

    expect(await screen.findByText(/Otra persona modificó la dirección de avisos/)).toBeInTheDocument()
    expect(screen.queryByText('Dirección de avisos guardada.')).not.toBeInTheDocument()
    // Tras el conflicto se relee el sello vigente para poder volver a intentar.
    await waitFor(() => expect(mocks.lectura).toHaveBeenCalledTimes(2))
  })

  it('traduce el rechazo por permisos (42501) sin mostrar el error crudo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    abrir()
    fireEvent.change(await screen.findByLabelText('Correo para avisos de consultas'), {
      target: { value: 'avisos@tienda.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección de avisos' }))

    expect(await screen.findByText('No tenés permiso para editar la dirección de avisos.')).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
  })

  it('sin empresas = edición queda en solo lectura: campo deshabilitado y sin botón', async () => {
    abrir(true)
    await waitFor(() => expect(screen.getByLabelText('Correo para avisos de consultas')).toHaveValue(CONTACTO))
    expect(screen.getByLabelText('Correo para avisos de consultas')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar dirección de avisos' })).not.toBeInTheDocument()
  })

  it('si la lectura falla muestra el error y ofrece reintentar', async () => {
    mocks.lectura.mockResolvedValueOnce({ data: null, error: { message: 'red' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar la dirección de avisos.')).toBeInTheDocument()
    expect(screen.getByLabelText('Correo para avisos de consultas')).toBeDisabled()

    mocks.lectura.mockResolvedValue({ data: null, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(screen.getByLabelText('Correo para avisos de consultas')).toHaveValue(CONTACTO))
    expect(screen.queryByText('No pudimos cargar la dirección de avisos.')).not.toBeInTheDocument()
  })
})
