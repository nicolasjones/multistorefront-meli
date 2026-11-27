import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { mananaEnArgentina, mesActual, rangoDelMes } from '../../lib/comisiones'
import type { Tecnico } from '../../lib/reparaciones'
import { ComisionesEquipo } from './ComisionesEquipo'
import { MisComisiones } from './MisComisiones'
import { ReglasComision } from './ReglasComision'

const FILA = (extra: Record<string, unknown> = {}) => ({
  reparacion_id: 'r-1', codigo: 'R-0001', empresa: 'San Javucho', equipo: 'Nintendo Switch Estándar', entrega_real: '2026-11-05',
  base: 15000, porcentaje_reparto: 100, porcentaje_regla: 15, comision: 2250, ...extra,
})
const DETALLE = (extra: Record<string, unknown> = {}) => ({
  desde: '2026-11-01', hasta: '2026-11-30', total: 3450, reparaciones: 2, sin_regla: 0, truncado: false,
  filas: [FILA(), FILA({ reparacion_id: 'r-3', codigo: 'R-0003', base: 10000, porcentaje_reparto: 60, comision: 900, entrega_real: '2026-11-12' })],
  ...extra,
})
const RESUMEN = {
  desde: '2026-11-01', hasta: '2026-11-30', total: 5850, reparaciones: 4, sin_regla: 0,
  tecnicos: [
    { tecnico_id: 'u-1', nombre: 'Tomás Uno', reparaciones: 3, base: 25000, comision: 3450, sin_regla: 0 },
    { tecnico_id: 'u-2', nombre: 'Tamara Dos', reparaciones: 2, base: 24000, comision: 2400, sin_regla: 0 },
  ],
}
const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre)

beforeEach(() => {
  mocks.rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('MisComisiones', () => {
  it('pide el mes actual, muestra el total y el detalle y nunca manda un usuario', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE(), error: null })
    render(<MisComisiones />)
    expect(await screen.findByTestId('total-comision')).toHaveTextContent('$ 3.450')
    const { desde, hasta } = rangoDelMes(mesActual())
    expect(mocks.rpc).toHaveBeenCalledWith('mis_comisiones', { p_desde: desde, p_hasta: hasta })
    const tabla = screen.getByRole('table', { name: 'Detalle de tus comisiones por reparación' })
    expect(within(tabla).getByText('R-0001')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 2.250')).toBeInTheDocument()
    expect(within(tabla).getByText('60 %')).toBeInTheDocument()
    expect(within(tabla).getAllByText('15 %')).toHaveLength(2)
    expect(screen.getByText(/no registra pagos/)).toBeInTheDocument()
  })

  it('no muestra costos ni márgenes ni ganancia', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE(), error: null })
    render(<MisComisiones />)
    await screen.findByTestId('total-comision')
    for (const prohibido of [/costo/i, /margen/i, /ganancia/i]) {
      expect(screen.queryByText(prohibido)).not.toBeInTheDocument()
    }
  })

  it('cambiar de mes pide el rango nuevo y descarta lo anterior', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: DETALLE(), error: null })
    mocks.rpc.mockImplementationOnce(() => new Promise(() => undefined))
    render(<MisComisiones />)
    await screen.findByTestId('total-comision')
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2028-02' } })
    await waitFor(() => expect(llamadas('mis_comisiones')).toHaveLength(2))
    expect(llamadas('mis_comisiones')[1][1]).toEqual({ p_desde: '2028-02-01', p_hasta: '2028-02-29' })
    expect(screen.queryByTestId('total-comision')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando tus comisiones' })).toBeInTheDocument()
  })

  it('un mes inválido (campo vaciado) no dispara una consulta', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE(), error: null })
    render(<MisComisiones />)
    await screen.findByTestId('total-comision')
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '' } })
    expect(llamadas('mis_comisiones')).toHaveLength(1)
  })

  it('la respuesta tardía de un mes anterior no pisa la del mes nuevo', async () => {
    let tardia: ((v: unknown) => void) | undefined
    mocks.rpc.mockImplementationOnce(() => new Promise((r) => { tardia = r }))
    mocks.rpc.mockResolvedValueOnce({ data: DETALLE({ total: 111 }), error: null })
    render(<MisComisiones />)
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2027-01' } })
    expect(await screen.findByTestId('total-comision')).toHaveTextContent('$ 111')
    await act(async () => {
      tardia?.({ data: DETALLE({ total: 999 }), error: null })
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(screen.getByTestId('total-comision')).toHaveTextContent('$ 111')
  })

  it('con todas las reparaciones con regla no muestra el aviso de «sin regla» ni el de tope', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE({ sin_regla: 0, truncado: false }), error: null })
    render(<MisComisiones />)
    await screen.findByTestId('total-comision')
    expect(screen.queryByText(/regla de comisión vigente a su fecha/)).not.toBeInTheDocument()
    expect(screen.queryByText(/más de 1\.000/)).not.toBeInTheDocument()
  })

  it('sin comisiones en el mes lo explica', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE({ total: 0, reparaciones: 0, filas: [] }), error: null })
    render(<MisComisiones />)
    expect(await screen.findByText('No tenés comisiones en este mes.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('avisa las reparaciones sin regla (singular y plural) y el tope de filas', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE({ sin_regla: 1, truncado: true }), error: null })
    const { unmount } = render(<MisComisiones />)
    expect(await screen.findByText(/1 reparación no tiene una regla de comisión vigente/)).toBeInTheDocument()
    expect(screen.getByText(/más de 1\.000 reparaciones/)).toBeInTheDocument()
    unmount()
    mocks.rpc.mockResolvedValue({ data: DETALLE({ sin_regla: 3 }), error: null })
    render(<MisComisiones />)
    expect(await screen.findByText(/3 reparaciones no tienen una regla/)).toBeInTheDocument()
    expect(screen.queryByText(/más de 1\.000/)).not.toBeInTheDocument()
  })

  it('una fila sin regla dice «Sin regla»', async () => {
    mocks.rpc.mockResolvedValue({ data: DETALLE({ filas: [FILA({ porcentaje_regla: null, comision: 0 })], sin_regla: 1 }), error: null })
    render(<MisComisiones />)
    expect(await screen.findByText('Sin regla')).toBeInTheDocument()
  })

  it('si falla muestra un texto accionable (no el de la base) y Reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'detalle interno' } })
    mocks.rpc.mockResolvedValueOnce({ data: DETALLE(), error: null })
    render(<MisComisiones />)
    expect(await screen.findByText('No pudimos cargar tus comisiones.')).toBeInTheDocument()
    expect(screen.queryByText('detalle interno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('total-comision')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    mocks.rpc.mockResolvedValue({ data: DETALLE({ sin_regla: 1 }), error: null })
    const { container } = render(<MisComisiones />)
    await screen.findByTestId('total-comision')
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('ComisionesEquipo', () => {
  const rpcEquipo = () => mocks.rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
    if (nombre === 'comisiones_resumen') return { data: RESUMEN, error: null }
    if (nombre === 'comisiones_de_tecnico') return { data: DETALLE({ total: args.p_tecnico === 'u-2' ? 2400 : 3450 }), error: null }
    return { data: null, error: null }
  })

  it('lista a cada técnico con su comisión y el total del mes', async () => {
    rpcEquipo()
    render(<ComisionesEquipo />)
    const tabla = await screen.findByRole('table', { name: 'Comisiones por técnico' })
    expect(within(tabla).getByText('Tomás Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 3.450')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 2.400')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Totales del mes' })).toHaveTextContent('$ 5.850')
  })

  it('«Ver detalle» abre el de ese técnico y cambiar de mes lo cierra', async () => {
    rpcEquipo()
    render(<ComisionesEquipo />)
    fireEvent.click(await screen.findByRole('button', { name: /Ver detalle de Tamara Dos/ }))
    expect(await screen.findByRole('heading', { name: 'Detalle de Tamara Dos' })).toBeInTheDocument()
    expect(llamadas('comisiones_de_tecnico')[0][1]).toMatchObject({ p_tecnico: 'u-2' })
    expect(await screen.findByText(/en 2 reparaciones/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '2027-03' } })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Detalle de Tamara Dos' })).not.toBeInTheDocument())
  })

  it('«Cerrar detalle» lo oculta y un técnico dado de baja no tiene detalle', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...RESUMEN, tecnicos: [{ tecnico_id: null, nombre: 'Técnico dado de baja', reparaciones: 1, base: 100, comision: 10, sin_regla: 0 }, ...RESUMEN.tecnicos] }, error: null })
    render(<ComisionesEquipo />)
    await screen.findByText('Técnico dado de baja')
    expect(screen.getAllByRole('button', { name: /Ver detalle/ })).toHaveLength(2)
  })

  it('avisa las participaciones sin regla y un mes vacío', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...RESUMEN, sin_regla: 2 }, error: null })
    const { unmount } = render(<ComisionesEquipo />)
    expect(await screen.findByText(/2 participaciones no tienen una regla/)).toBeInTheDocument()
    unmount()
    mocks.rpc.mockResolvedValue({ data: { ...RESUMEN, total: 0, reparaciones: 0, tecnicos: [] }, error: null })
    render(<ComisionesEquipo />)
    expect(await screen.findByText('No hay comisiones en este mes.')).toBeInTheDocument()
  })

  it('si falla, error accionable con Reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    mocks.rpc.mockResolvedValueOnce({ data: RESUMEN, error: null })
    render(<ComisionesEquipo />)
    expect(await screen.findByText('No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Comisiones por técnico' })).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px (con detalle abierto)', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    rpcEquipo()
    const { container } = render(<ComisionesEquipo />)
    fireEvent.click(await screen.findByRole('button', { name: /Ver detalle de Tomás Uno/ }))
    await screen.findByRole('table', { name: 'Detalle de comisiones de Tomás Uno' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('ReglasComision', () => {
  const TECNICOS: Tecnico[] = [{ user_id: 'u-1', nombre: 'Tomás Uno' }, { user_id: 'u-2', nombre: 'Tamara Dos' }]
  const REGLAS = [
    { id: 'g-1', tecnico_id: null, tecnico: null, porcentaje: 10, vigente_desde: '2026-10-26', estado: 'vigente' },
    { id: 't-1', tecnico_id: 'u-1', tecnico: 'Tomás Uno', porcentaje: 15, vigente_desde: '2026-10-27', estado: 'reemplazada' },
    { id: 't-2', tecnico_id: 'u-1', tecnico: 'Tomás Uno', porcentaje: 20, vigente_desde: '2027-01-01', estado: 'futura' },
  ]
  const rpcReglas = (guardar?: () => unknown) => mocks.rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'listar_reglas_comision') return { data: REGLAS, error: null }
    if (nombre === 'guardar_regla_comision') return guardar ? guardar() : { data: { id: 'n' }, error: null }
    return { data: null, error: null }
  })

  it('lista las reglas con su estado y la general como «Todos los técnicos»', async () => {
    rpcReglas()
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    const tabla = await screen.findByRole('table', { name: 'Reglas de comisión' })
    expect(within(tabla).getByText('Todos los técnicos')).toBeInTheDocument()
    for (const estado of ['Vigente', 'Reemplazada', 'Futura']) expect(within(tabla).getByText(estado)).toBeInTheDocument()
    expect(within(tabla).getByText('26/10/2026')).toBeInTheDocument()
  })

  it('sin permiso de edición solo las ve', async () => {
    rpcReglas()
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar={false} />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    expect(screen.queryByRole('button', { name: 'Agregar regla' })).not.toBeInTheDocument()
    expect(screen.getByText(/cargarlas exige permiso de edición/)).toBeInTheDocument()
  })

  it('valida el porcentaje antes de enviar y manda el correcto', async () => {
    rpcReglas()
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    const porcentaje = screen.getByLabelText('Porcentaje')
    for (const malo of ['', '100,01', '-1', '12,345', 'abc']) {
      fireEvent.change(porcentaje, { target: { value: malo } })
      fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
      expect(await screen.findByText('El porcentaje tiene que estar entre 0 y 100, con hasta dos decimales'), malo).toBeInTheDocument()
    }
    expect(llamadas('guardar_regla_comision')).toHaveLength(0)
    fireEvent.change(porcentaje, { target: { value: '12,5' } })
    fireEvent.change(screen.getByLabelText('Rige desde'), { target: { value: '2099-01-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
    await waitFor(() => expect(llamadas('guardar_regla_comision')).toHaveLength(1))
    expect(llamadas('guardar_regla_comision')[0][1]).toEqual({ p_tecnico: null, p_porcentaje: 12.5, p_vigente_desde: '2099-01-15' })
    expect(await screen.findByText('Regla guardada.')).toBeInTheDocument()
    await waitFor(() => expect(llamadas('listar_reglas_comision')).toHaveLength(2))
    expect((porcentaje as HTMLInputElement).value).toBe('')
  })

  it('la vigencia arranca en mañana y una fecha anterior se rechaza sin llamar a la base', async () => {
    rpcReglas()
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    const vigencia = screen.getByLabelText('Rige desde') as HTMLInputElement
    expect(vigencia.value).toBe(mananaEnArgentina())
    expect(vigencia.min).toBe(mananaEnArgentina())
    fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: '5' } })
    fireEvent.change(vigencia, { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
    expect(await screen.findByText('La regla rige desde mañana como pronto: no cambia lo ya entregado')).toBeInTheDocument()
    expect(llamadas('guardar_regla_comision')).toHaveLength(0)
    fireEvent.change(vigencia, { target: { value: mananaEnArgentina() } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
    await waitFor(() => expect(llamadas('guardar_regla_comision')).toHaveLength(1))
  })

  it('100 y 0 son válidos (fronteras) y la regla de un técnico lleva su id', async () => {
    rpcReglas()
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Técnico' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Tamara Dos' }))
    for (const [valor, esperado] of [['100', 100], ['0', 0]] as const) {
      fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: valor } })
      fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
      await waitFor(() => expect(llamadas('guardar_regla_comision').at(-1)?.[1]).toMatchObject({ p_tecnico: 'u-2', p_porcentaje: esperado }))
    }
  })

  it('muestra el error de duplicado de la base', async () => {
    rpcReglas(() => ({ data: null, error: { code: '23505', message: 'Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.' } }))
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar regla' }))
    expect(await screen.findByText('Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.')).toBeInTheDocument()
  })

  it('sin reglas explica que no habrá comisión', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    expect(await screen.findByText('Todavía no hay reglas de comisión.')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    rpcReglas()
    const { container } = render(<ReglasComision tecnicos={TECNICOS} puedeCargar />)
    await screen.findByRole('table', { name: 'Reglas de comisión' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
