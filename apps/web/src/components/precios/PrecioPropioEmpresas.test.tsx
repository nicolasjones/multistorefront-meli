import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), netos: vi.fn(), useEmpresas: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ returns: mocks.netos }) }) }),
  },
}))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))

import { PrecioPropioEmpresas } from './PrecioPropioEmpresas'

type Fila = { empresa_id: string; moneda: string; importe: number }

// Base en memoria por producto: lo que devuelve `leer_precios_propios` y lo que cambian fijar / quitar.
let guardados: Record<string, Fila[]>

const instalarRpc = (errorPara?: { nombre: string; code: string }) =>
  mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
    if (errorPara?.nombre === nombre) return { data: null, error: { code: errorPara.code, message: 'detalle interno' } }
    const producto = args.p_producto as string
    const lista = guardados[producto] ?? []
    if (nombre === 'leer_precios_propios') return { data: lista, error: null }
    if (nombre === 'fijar_precio_propio') {
      guardados[producto] = [
        ...lista.filter((fila) => fila.empresa_id !== args.p_empresa),
        { empresa_id: args.p_empresa as string, moneda: args.p_moneda as string, importe: args.p_importe as number },
      ]
      return { data: { moneda: args.p_moneda, importe: args.p_importe }, error: null }
    }
    if (nombre === 'quitar_precio_propio') {
      guardados[producto] = lista.filter((fila) => fila.empresa_id !== args.p_empresa)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  })

const EMPRESAS = [
  { id: 'emp-1', nombre: 'San Javucho', activa: true },
  { id: 'emp-2', nombre: 'Mundo JC', activa: true },
  { id: 'emp-3', nombre: 'No lo vende', activa: true },
]

const montar = (props: Partial<React.ComponentProps<typeof PrecioPropioEmpresas>> = {}) =>
  render(<PrecioPropioEmpresas productoId="p-1" empresaIds={['emp-1', 'emp-2']} soloLectura={false} {...props} />)

describe('PrecioPropioEmpresas (F-PRE-08, FR-016, FR-018, FR-019)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    guardados = { 'p-1': [], 'p-2': [{ empresa_id: 'emp-1', moneda: 'USD', importe: 20 }] }
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.netos.mockResolvedValue({ data: [], error: null })
    instalarRpc()
  })

  it('[MSF-423:T028] una fila por empresa del producto, con Moneda, Precio propio y Quitar', async () => {
    montar()
    expect(await screen.findByLabelText('Precio propio (San Javucho)')).toBeInTheDocument()
    expect(screen.getByLabelText('Precio propio (Mundo JC)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Precio propio (No lo vende)')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Moneda (San Javucho)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar precio propio de San Javucho' })).toBeDisabled()
    expect(screen.queryByText('Precio propio', { selector: '.MuiChip-label' })).not.toBeInTheDocument()
  })

  it('[MSF-423:T028] alta: fija el precio y la fila queda con la marca «Precio propio»', async () => {
    montar()
    const campo = await screen.findByLabelText('Precio propio (Mundo JC)')
    fireEvent.change(campo, { target: { value: '27000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio propio de Mundo JC' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('fijar_precio_propio', {
        p_producto: 'p-1', p_empresa: 'emp-2', p_moneda: 'ARS', p_importe: 27000,
      }),
    )
    expect(await screen.findByText('Precio propio', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByLabelText('Precio propio (San Javucho)')).toHaveValue('')
  })

  it('[MSF-423:T028] edición: carga lo guardado, cambia la moneda y el importe y vuelve a fijar', async () => {
    montar({ productoId: 'p-2', empresaIds: ['emp-1'] })
    const campo = await screen.findByLabelText('Precio propio (San Javucho)')
    expect(campo).toHaveValue('20')
    expect(screen.getByText('Precio propio', { selector: '.MuiChip-label' })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Moneda (San Javucho)' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /ARS/ }))
    fireEvent.change(campo, { target: { value: '27000,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio propio de San Javucho' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('fijar_precio_propio', {
        p_producto: 'p-2', p_empresa: 'emp-1', p_moneda: 'ARS', p_importe: 27000.5,
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('Precio propio (San Javucho)')).toHaveValue('27000,5'))
  })

  it('[MSF-423:T028] quitar: llama a la RPC y la empresa vuelve a la regla', async () => {
    montar({ productoId: 'p-2', empresaIds: ['emp-1'] })
    await screen.findByLabelText('Precio propio (San Javucho)')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar precio propio de San Javucho' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('quitar_precio_propio', { p_producto: 'p-2', p_empresa: 'emp-1' }))
    await waitFor(() => expect(screen.getByLabelText('Precio propio (San Javucho)')).toHaveValue(''))
    expect(screen.queryByText('Precio propio', { selector: '.MuiChip-label' })).not.toBeInTheDocument()
    expect(screen.getByText('Sin precio propio: rige la regla de la empresa.')).toBeInTheDocument()
  })

  it.each([
    ['', 'Ingresá el precio propio.'],
    ['0', 'El precio propio debe ser mayor que cero.'],
    ['-5', 'Ingresá un precio válido: solo números, hasta 12 enteros y 2 decimales.'],
    ['abc', 'Ingresá un precio válido: solo números, hasta 12 enteros y 2 decimales.'],
    ['10,123', 'Ingresá un precio válido: solo números, hasta 12 enteros y 2 decimales.'],
  ])('[MSF-423:T028] validación: «%s» muestra un mensaje claro y no guarda', async (texto, mensaje) => {
    montar({ empresaIds: ['emp-1'] })
    const campo = await screen.findByLabelText('Precio propio (San Javucho)')
    // Un cambio de vacío a vacío no habilita Guardar: se escribe algo y se vuelve al texto de prueba.
    fireEvent.change(campo, { target: { value: 'x' } })
    fireEvent.change(campo, { target: { value: texto } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio propio de San Javucho' }))
    expect(await screen.findByText(mensaje)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('fijar_precio_propio', expect.anything())
  })

  it('[MSF-423:T028] un error de la base se muestra en castellano, sin el detalle interno', async () => {
    instalarRpc({ nombre: 'fijar_precio_propio', code: '42501' })
    montar({ empresaIds: ['emp-1'] })
    fireEvent.change(await screen.findByLabelText('Precio propio (San Javucho)'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precio propio de San Javucho' }))
    expect(await screen.findByText(/Tu rol no puede editar los precios propios/)).toBeInTheDocument()
    expect(screen.queryByText(/detalle interno/)).not.toBeInTheDocument()
  })

  it('[MSF-423:T028] solo lectura: ve el precio y la marca, sin poder editar ni quitar', async () => {
    montar({ productoId: 'p-2', empresaIds: ['emp-1'], soloLectura: true })
    const campo = await screen.findByLabelText('Precio propio (San Javucho)')
    expect(campo).toHaveValue('20')
    expect(campo).toBeDisabled()
    expect(screen.getByText('Precio propio', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Guardar precio propio/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar precio propio/ })).not.toBeInTheDocument()
  })

  it('[MSF-423:T028] muestra el neto de ejemplo que calcula la base', async () => {
    guardados['p-1'] = [{ empresa_id: 'emp-2', moneda: 'ARS', importe: 27000 }]
    mocks.netos.mockResolvedValue({ data: [{ empresa_id: 'emp-2', neto_ars: 27000 }], error: null })
    montar()
    expect(await screen.findByText('Neto sin IVA: $ 27.000')).toBeInTheDocument()
  })

  it('[MSF-423:T029] al cambiar de producto no arrastra importes ni borradores del anterior', async () => {
    const { rerender } = montar({ productoId: 'p-2', empresaIds: ['emp-1'] })
    const campo = await screen.findByLabelText('Precio propio (San Javucho)')
    expect(campo).toHaveValue('20')
    fireEvent.change(campo, { target: { value: '999' } })
    rerender(<PrecioPropioEmpresas productoId="p-1" empresaIds={['emp-1']} soloLectura={false} />)
    await waitFor(() => expect(screen.getByLabelText('Precio propio (San Javucho)')).toHaveValue(''))
    expect(screen.queryByText('Precio propio', { selector: '.MuiChip-label' })).not.toBeInTheDocument()
  })

  it('[MSF-423:T029] al cambiar las empresas del producto las filas siguen a la selección', async () => {
    const { rerender } = montar({ empresaIds: ['emp-1'] })
    await screen.findByLabelText('Precio propio (San Javucho)')
    expect(screen.queryByLabelText('Precio propio (Mundo JC)')).not.toBeInTheDocument()
    rerender(<PrecioPropioEmpresas productoId="p-1" empresaIds={['emp-2']} soloLectura={false} />)
    expect(await screen.findByLabelText('Precio propio (Mundo JC)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Precio propio (San Javucho)')).not.toBeInTheDocument()
  })

  it('una empresa con precio propio guardado sigue visible aunque ya no se venda ahí, para poder quitarlo', async () => {
    montar({ productoId: 'p-2', empresaIds: [] })
    expect(await screen.findByLabelText('Precio propio (San Javucho)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar precio propio de San Javucho' })).toBeEnabled()
    expect(screen.queryByText(/no se vende en ninguna empresa todavía/)).not.toBeInTheDocument()
  })

  it('sin empresas en el producto explica qué hacer; si la lectura falla, avisa sin romper la ficha', async () => {
    const { unmount } = montar({ empresaIds: [] })
    expect(await screen.findByText(/no se vende en ninguna empresa todavía/)).toBeInTheDocument()
    unmount()
    instalarRpc({ nombre: 'leer_precios_propios', code: 'XX000' })
    montar()
    expect(await screen.findByText(/No pudimos cargar los precios propios/)).toBeInTheDocument()
  })
})
