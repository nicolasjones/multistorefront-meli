import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ vistaPreviaFusion: vi.fn(), fusionarClientes: vi.fn() }))

vi.mock('../../lib/clientes', async (original) => ({
  ...(await original<typeof import('../../lib/clientes')>()),
  vistaPreviaFusion: mocks.vistaPreviaFusion,
  fusionarClientes: mocks.fusionarClientes,
}))
vi.mock('../service/ClienteSelector', () => ({
  ClienteSelector: ({ onCambio }: { onCambio: (c: { id: string; nombre: string; contacto: string } | null) => void }) => (
    <>
      <button onClick={() => onCambio({ id: 'c-2', nombre: 'Alfa duplicado', contacto: '' })}>Elegir otro</button>
      <button onClick={() => onCambio({ id: 'c-1', nombre: 'Alfa', contacto: '' })}>Elegir el mismo</button>
    </>
  ),
}))

import { DialogoFusionarClientes } from './DialogoFusionarClientes'

const actual = { id: 'c-1', numero: 101, nombre: 'Alfa' }
const previa = (activasA = 0, activasB = 0) => [
  { cliente_id: 'c-1', numero: 101, nombre: 'Alfa', documentos: 3, cuentas_web_activas: activasA, cuentas_web_total: activasA },
  { cliente_id: 'c-2', numero: 102, nombre: 'Alfa duplicado', documentos: 5, cuentas_web_activas: activasB, cuentas_web_total: activasB },
]
const abrir = (onFusionado = vi.fn(), onCerrar = vi.fn()) => {
  render(<DialogoFusionarClientes abierto cliente={actual} onCerrar={onCerrar} onFusionado={onFusionado} />)
  return { onFusionado, onCerrar }
}
const elegirOtro = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Elegir otro' }))
  await screen.findByText(/3 compras y 5 compras/)
}
const confirmar = () => screen.getByRole('button', { name: 'Fusionar clientes' })

describe('DialogoFusionarClientes (F-CLI-18, FR-013, SC-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vistaPreviaFusion.mockResolvedValue(previa())
    mocks.fusionarClientes.mockResolvedValue({ documentos_reasignados: 5, cuentas_reasignadas: 0, campanas_reasignadas: 0 })
  })

  it('abre con título accesible y sin poder confirmar hasta elegir el otro cliente', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Fusionar clientes' })).toBeInTheDocument()
    expect(confirmar()).toBeDisabled()
  })

  it('muestra la vista previa «3 y 5 compras» y conserva por defecto la ficha actual', async () => {
    abrir()
    await elegirOtro()
    expect(mocks.vistaPreviaFusion).toHaveBeenCalledWith('c-1', 'c-2')
    expect(screen.getByText(/quedará con 8 compras/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Nº 101 · Alfa · 3 compras/ })).toBeChecked()
    expect(screen.queryByText('Cuenta web que se mantiene')).not.toBeInTheDocument()
  })

  it('fusiona conservando la ficha elegida y avisa cuál quedó', async () => {
    const { onFusionado } = abrir()
    await elegirOtro()
    fireEvent.click(screen.getByRole('radio', { name: /Nº 102 · Alfa duplicado · 5 compras/ }))
    fireEvent.click(confirmar())
    await waitFor(() => expect(onFusionado).toHaveBeenCalledWith('c-2'))
    expect(mocks.fusionarClientes).toHaveBeenCalledWith('c-2', 'c-1', null)
  })

  it('con las dos cuentas web activas obliga a elegir cuál se mantiene', async () => {
    mocks.vistaPreviaFusion.mockResolvedValue(previa(1, 1))
    const { onFusionado } = abrir()
    await elegirOtro()
    expect(screen.getByText('Cuenta web que se mantiene')).toBeInTheDocument()
    expect(confirmar()).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'La de Alfa duplicado' }))
    expect(confirmar()).toBeEnabled()
    fireEvent.click(confirmar())
    await waitFor(() => expect(onFusionado).toHaveBeenCalledWith('c-1'))
    expect(mocks.fusionarClientes).toHaveBeenCalledWith('c-1', 'c-2', 'c-2')
  })

  it('rechaza elegir el mismo cliente', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir el mismo' }))
    expect(screen.getByText('Elegí un cliente distinto del actual.')).toBeInTheDocument()
    expect(confirmar()).toBeDisabled()
    expect(mocks.vistaPreviaFusion).not.toHaveBeenCalled()
  })

  it('muestra el error claro de la base sin cerrar ni avisar éxito', async () => {
    mocks.fusionarClientes.mockRejectedValue({ code: '22023', message: 'Alguno de los clientes ya está archivado (¿la fusión ya se hizo?)' })
    const { onFusionado } = abrir()
    await elegirOtro()
    fireEvent.click(confirmar())
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está archivado')
    expect(onFusionado).not.toHaveBeenCalled()
  })

  it('un error técnico se muestra genérico, sin detalles de la base', async () => {
    mocks.fusionarClientes.mockRejectedValue({ code: '40001', message: 'deadlock detected on relation clientes' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    await elegirOtro()
    fireEvent.click(confirmar())
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('No pudimos fusionar los clientes')
    expect(alerta).not.toHaveTextContent('deadlock')
  })

  it('si falla la vista previa ofrece reintentar', async () => {
    mocks.vistaPreviaFusion.mockRejectedValueOnce({ code: '42501', message: 'Solo el Administrador puede fusionar clientes' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro' }))
    expect(await screen.findByText('Solo el Administrador puede fusionar clientes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText(/3 compras y 5 compras/)
  })

  it('Cancelar y la X cierran el diálogo', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onCerrar).toHaveBeenCalledTimes(2)
  })
})
