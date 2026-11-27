import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import type { Tecnico } from '../../lib/reparaciones'
import { RepartoComision } from './RepartoComision'

const TECNICOS: Tecnico[] = [
  { user_id: 'u-1', nombre: 'Tomás Uno' },
  { user_id: 'u-2', nombre: 'Tamara Dos' },
  { user_id: 'u-3', nombre: 'Teo Tres' },
]

const reparto = (extra: Record<string, unknown> = {}) => ({
  reparacion_id: 'r-1', congelado: false, anulada: false, por_defecto: true, puede_editar: true,
  reparto: [{ tecnico_id: 'u-1', nombre: 'Tomás Uno', porcentaje: 100 }],
  ...extra,
})

const montar = (inicial: Record<string, unknown> = reparto(), alGuardar?: (args: Record<string, unknown>) => unknown) => {
  mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
    if (nombre === 'obtener_reparto_comision') return { data: inicial, error: null }
    if (nombre === 'guardar_reparto_comision') {
      const resultado = alGuardar ? await alGuardar(args) : null
      if (resultado && typeof resultado === 'object' && 'error' in (resultado as object)) return resultado
      return { data: resultado ?? reparto({ por_defecto: false }), error: null }
    }
    return { data: null, error: null }
  })
  return render(<RepartoComision reparacionId="r-1" tecnicos={TECNICOS} />)
}

const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre)

const elegirTecnico = async (indice: number, nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: `Técnico ${indice}` }))
  fireEvent.click(await screen.findByRole('option', { name: nombre }))
}
const escribirPorcentaje = (indice: number, valor: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: `Porcentaje del técnico ${indice}` }), { target: { value: valor } })

describe('RepartoComision · lectura', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('muestra el reparto por defecto sin importes y ofrece repartir', async () => {
    montar()
    const lista = await screen.findByRole('list', { name: 'Reparto de la comisión' })
    expect(within(lista).getByText('Tomás Uno')).toBeInTheDocument()
    expect(within(lista).getByText('100 %')).toBeInTheDocument()
    expect(screen.getByText(/Reparto por defecto: 100 % al técnico asignado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repartir comisión' })).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(llamadas('obtener_reparto_comision')[0][1]).toEqual({ p_reparacion: 'r-1' })
  })

  it('un reparto personalizado lo dice y lista a cada técnico', async () => {
    montar(reparto({ por_defecto: false, reparto: [{ tecnico_id: 'u-1', nombre: 'Tomás Uno', porcentaje: 60 }, { tecnico_id: 'u-2', nombre: 'Tamara Dos', porcentaje: 40.5 }] }))
    expect(await screen.findByText('60 %')).toBeInTheDocument()
    expect(screen.getByText('40,5 %')).toBeInTheDocument()
    expect(screen.getByText('Reparto personalizado. Se congela al entregar la reparación.')).toBeInTheDocument()
  })

  it('sin técnico asignado explica que no hay comisión', async () => {
    montar(reparto({ reparto: [] }))
    expect(await screen.findByText(/Sin técnico asignado: la reparación no genera comisión/)).toBeInTheDocument()
  })

  it('sin permiso para editar no ofrece el botón y una entregada se ve congelada', async () => {
    montar(reparto({ puede_editar: false, congelado: true }))
    expect(await screen.findByText(/el reparto está congelado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Repartir comisión' })).not.toBeInTheDocument()
  })

  it('si falla la carga muestra el error y Reintentar vuelve a pedir', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'interno' } })
    mocks.rpc.mockResolvedValueOnce({ data: reparto(), error: null })
    render(<RepartoComision reparacionId="r-1" tecnicos={TECNICOS} />)
    expect(await screen.findByText('No pudimos cargar el reparto de la comisión.')).toBeInTheDocument()
    expect(screen.queryByText('interno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('list', { name: 'Reparto de la comisión' })).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})

describe('RepartoComision · edición', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('exige que sume 100 y envía el reparto exacto', async () => {
    montar(reparto(), () => reparto({ por_defecto: false, reparto: [{ tecnico_id: 'u-1', nombre: 'Tomás Uno', porcentaje: 60 }, { tecnico_id: 'u-2', nombre: 'Tamara Dos', porcentaje: 40 }] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    const guardar = screen.getByRole('button', { name: 'Guardar reparto' })
    expect(guardar).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar técnico' }))
    await elegirTecnico(2, 'Tamara Dos')
    escribirPorcentaje(2, '40')
    expect(screen.getByText('Suma: 140 %')).toBeInTheDocument()
    expect(screen.getByText('Los porcentajes del reparto tienen que sumar 100 %')).toBeInTheDocument()
    expect(guardar).toBeDisabled()
    escribirPorcentaje(1, '60')
    expect(screen.getByText('Suma: 100 %')).toBeInTheDocument()
    expect(guardar).toBeEnabled()
    fireEvent.click(guardar)
    await waitFor(() => expect(llamadas('guardar_reparto_comision')).toHaveLength(1))
    expect(llamadas('guardar_reparto_comision')[0][1]).toEqual({
      p_reparacion: 'r-1',
      p_reparto: [{ tecnico_id: 'u-1', porcentaje: 60 }, { tecnico_id: 'u-2', porcentaje: 40 }],
      p_motivo: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Reparto personalizado. Se congela al entregar la reparación.')).toBeInTheDocument()
    expect(screen.getByText('Tamara Dos')).toBeInTheDocument()
  })

  it('no deja repetir un técnico ni usar 0 o decimales de más', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar técnico' }))
    await elegirTecnico(2, 'Tomás Uno')
    escribirPorcentaje(1, '50')
    escribirPorcentaje(2, '50')
    expect(screen.getByText('Un técnico no puede repetirse en el reparto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar reparto' })).toBeDisabled()
    await elegirTecnico(2, 'Teo Tres')
    escribirPorcentaje(2, '0')
    expect(screen.getByText(/mayor que 0, hasta 100 y con dos decimales/)).toBeInTheDocument()
    escribirPorcentaje(2, '49,999')
    expect(screen.getByText(/mayor que 0, hasta 100 y con dos decimales/)).toBeInTheDocument()
    escribirPorcentaje(2, '50')
    expect(screen.getByRole('button', { name: 'Guardar reparto' })).toBeEnabled()
  })

  it('quitar una línea y el tope de 10 técnicos', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    expect(screen.getByRole('button', { name: 'Quitar al técnico 1' })).toBeDisabled()
    const agregar = screen.getByRole('button', { name: 'Agregar técnico' })
    for (let i = 0; i < 9; i += 1) fireEvent.click(agregar)
    expect(screen.getAllByRole('combobox')).toHaveLength(10)
    expect(agregar).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar al técnico 10' }))
    expect(screen.getAllByRole('combobox')).toHaveLength(9)
    expect(agregar).toBeEnabled()
  })

  it('una reparación entregada exige un motivo de al menos 3 caracteres y lo envía recortado', async () => {
    montar(reparto({ congelado: true, por_defecto: false }), () => reparto({ congelado: true, por_defecto: false }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    const guardar = screen.getByRole('button', { name: 'Guardar reparto' })
    expect(guardar).toBeDisabled()
    const motivo = screen.getByRole('textbox', { name: /Motivo del cambio/ })
    fireEvent.change(motivo, { target: { value: ' ab ' } })
    expect(guardar).toBeDisabled()
    fireEvent.change(motivo, { target: { value: '  Ajuste acordado  ' } })
    expect(guardar).toBeEnabled()
    // Congelado: no se ofrece volver al reparto por defecto.
    expect(screen.queryByRole('button', { name: 'Volver al reparto por defecto' })).not.toBeInTheDocument()
    fireEvent.click(guardar)
    await waitFor(() => expect(llamadas('guardar_reparto_comision')).toHaveLength(1))
    expect(llamadas('guardar_reparto_comision')[0][1]).toMatchObject({ p_motivo: 'Ajuste acordado' })
  })

  it('antes de entregar, un reparto personalizado puede volver al de por defecto (lista vacía)', async () => {
    montar(reparto({ por_defecto: false }), () => reparto())
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    expect(screen.queryByRole('textbox', { name: /Motivo/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver al reparto por defecto' }))
    await waitFor(() => expect(llamadas('guardar_reparto_comision')).toHaveLength(1))
    expect(llamadas('guardar_reparto_comision')[0][1]).toEqual({ p_reparacion: 'r-1', p_reparto: [], p_motivo: null })
  })

  it('muestra el mensaje de la base y conserva lo escrito si falla', async () => {
    montar(reparto(), () => ({ data: null, error: { code: '22023', message: 'El técnico no pertenece a la organización' } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reparto' }))
    expect(await screen.findByText('El técnico no pertenece a la organización')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('un permiso que cambió se explica sin mostrar el mensaje crudo', async () => {
    montar(reparto(), () => ({ data: null, error: { code: '42501', message: 'detalle interno' } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reparto' }))
    expect(await screen.findByText('No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.')).toBeInTheDocument()
    expect(screen.queryByText('detalle interno')).not.toBeInTheDocument()
  })

  it('un doble clic en Guardar envía una sola vez', async () => {
    let liberar: (() => void) | undefined
    montar(reparto(), () => new Promise((resolver) => { liberar = () => resolver(reparto({ por_defecto: false })) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    const guardar = screen.getByRole('button', { name: 'Guardar reparto' })
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    await waitFor(() => expect(llamadas('guardar_reparto_comision')).toHaveLength(1))
    liberar?.()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(llamadas('guardar_reparto_comision')).toHaveLength(1)
  })

  it('conserva como opción al técnico del reparto que ya no está en la lista (p. ej. dado de baja)', async () => {
    montar(reparto({ por_defecto: false, reparto: [{ tecnico_id: 'u-9', nombre: 'Ex Técnico', porcentaje: 100 }] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    expect(screen.getByRole('combobox', { name: 'Técnico 1' })).toHaveTextContent('Ex Técnico')
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px (diálogo abierto)', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    montar(reparto({ congelado: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir comisión' }))
    await screen.findByRole('dialog')
    expect(await violacionesAxe(document.body)).toEqual([])
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px (sección)', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = montar()
    await screen.findByRole('list', { name: 'Reparto de la comisión' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
