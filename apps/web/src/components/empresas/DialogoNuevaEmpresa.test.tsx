import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc } }))

import { DialogoNuevaEmpresa } from './DialogoNuevaEmpresa'

const empresas = [
  { id: 'e-1', nombre: 'San Javucho', activa: true },
  { id: 'e-2', nombre: 'Mundo JC', activa: false },
]

const abrir = (props: Partial<Parameters<typeof DialogoNuevaEmpresa>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onCreada = vi.fn()
  render(<DialogoNuevaEmpresa abierto empresas={empresas} onCerrar={onCerrar} onCreada={onCreada} {...props} />)
  return { onCerrar, onCreada }
}

const escribir = (nombre: string) => fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: nombre } })
const crear = () => fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }))

describe('DialogoNuevaEmpresa', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('muestra los textos del prototipo y el foco inicial en Nombre', () => {
    abrir()

    expect(screen.getByRole('dialog', { name: 'Nueva empresa' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej.: Tienda Oeste')).toBeInTheDocument()
    expect(screen.getByText('Precios, tienda web y reglas de Mercado Libre se copian como punto de partida.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre/)).toHaveFocus()
    expect(screen.getByRole('option', { name: 'Mundo JC' })).toBeInTheDocument()
  })

  it('envía el nombre recortado y el origen elegido, y avisa al crear', async () => {
    const { onCreada } = abrir()

    escribir('  Tienda Oeste  ')
    fireEvent.change(screen.getByLabelText('Copiar configuración de'), { target: { value: 'e-2' } })
    crear()

    await waitFor(() => expect(onCreada).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('crear_empresa', { p_nombre: 'Tienda Oeste', p_copiar_de: 'e-2' })
  })

  it('crea sin origen cuando el selector queda en «Sin copiar»', async () => {
    const { onCreada } = abrir()

    escribir('Tienda Sur')
    crear()

    await waitFor(() => expect(onCreada).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('crear_empresa', { p_nombre: 'Tienda Sur', p_copiar_de: null })
  })

  it('con nombre vacío o de solo espacios marca el campo y no llama al servidor', async () => {
    abrir()

    escribir('   ')
    crear()

    expect(await screen.findByText('Ingresá el nombre de la empresa.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre/)).toBeInvalid()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('muestra el nombre repetido en el campo y conserva lo escrito', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'Ya existe una empresa con ese nombre' } })
    const { onCreada } = abrir()

    escribir('Mundo JC')
    crear()

    expect(await screen.findByText('Ya existe una empresa con ese nombre.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Mundo JC')
    expect(onCreada).not.toHaveBeenCalled()
  })

  it('sin empresas de origen deshabilita el selector, avisa y permite crear igual', async () => {
    const { onCreada } = abrir({ empresas: [] })

    expect(screen.getByLabelText('Copiar configuración de')).toBeDisabled()
    expect(screen.getByText(/No hay una empresa de la que copiar/)).toBeInTheDocument()
    escribir('Primera')
    crear()

    await waitFor(() => expect(onCreada).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('crear_empresa', { p_nombre: 'Primera', p_copiar_de: null })
  })

  it('un doble clic envía una sola vez: el botón queda deshabilitado mientras guarda', async () => {
    let resolver: (valor: unknown) => void = () => {}
    rpc.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    abrir()

    escribir('Tienda Oeste')
    crear()

    const boton = await screen.findByRole('button', { name: 'Creando…' })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(rpc).toHaveBeenCalledTimes(1)
    resolver({ data: {}, error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear empresa' })).toBeEnabled())
  })

  it('ante un error de servidor muestra el aviso, conserva lo escrito y deja reintentar', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'boom' } })
    const { onCreada } = abrir()

    escribir('Tienda Oeste')
    crear()

    expect(await screen.findByText('No pudimos crear la empresa. Probá de nuevo.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Tienda Oeste')
    crear()

    await waitFor(() => expect(onCreada).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('Cancelar cierra el diálogo sin llamar al servidor', () => {
    const { onCerrar } = abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCerrar).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
