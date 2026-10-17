import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { functions: { invoke: mocks.invoke } },
}))

import { CorreoMasivoClientes } from './CorreoMasivoClientes'
import { EtiquetasClientes } from './EtiquetasClientes'

const cliente = (id: string, correo: string | null) => ({
  id, numero: 1, nombre: `C ${id}`, documento: null, correo, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista' as const, es_consumidor_final: false, archivado_en: null,
})

describe('CorreoMasivoClientes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envía asunto y mensaje a los ids y muestra el resultado', async () => {
    mocks.invoke.mockResolvedValue({ data: { enviados: 1, sin_correo: 1 }, error: null })
    render(<CorreoMasivoClientes ids={['a', 'b']} conCorreo={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enviar correo a seleccionados \(2\)/ }))
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(screen.getByText(/Correo enviado a 1 clientes/)).toBeInTheDocument())
    expect(mocks.invoke).toHaveBeenCalledWith('enviar-correo-clientes', {
      body: { ids: ['a', 'b'], asunto: expect.any(String), mensaje: 'Hola' },
    })
  })

  it('si falla, informa sin decir enviado', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(<CorreoMasivoClientes ids={['a']} conCorreo={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Enviar correo/ }))
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})

describe('EtiquetasClientes', () => {
  it('previsualiza las etiquetas y deshabilita sin selección', () => {
    const { unmount } = render(<EtiquetasClientes seleccionados={[]} />)
    expect(screen.getByRole('button', { name: 'Etiquetas' })).toBeDisabled()
    unmount()
    render(<EtiquetasClientes seleccionados={[cliente('a', 'a@x.com'), cliente('b', null)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas' }))
    expect(screen.getByText('C a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument()
  })
})
