import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import type { EnvioMoto } from '../../lib/ventas/enviosMoto'
import { esRendible, mensajerosDeSeleccion, rendirEnviosMoto, resumenMotosSinRendir, totalesDeSeleccion } from '../../lib/ventas/enviosMotoRendicion'
import { RendicionMotosDialog } from './RendicionMotosDialog'

const envio = (id: string, extra: Partial<EnvioMoto> = {}): EnvioMoto => ({
  id, comprobante_id: `f-${id}`, comprobante_numero: `0003-0000000${id}`, empresa_id: 'e-1', empresa: 'San Javucho',
  fecha: '2026-10-07', cliente: 'Cliente', mensajero: 'Moto 1', guia: null, costo_envio: 3500, abono: 10000,
  enviado: true, rendido: false, rendido_en: null, actualizado_en: '2026-10-07T10:00:00+00:00', puede_editar: true, puede_rendir: true, bloqueado_motivo: null,
  ...extra,
})

describe('lib de rendición', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('el total es la suma del abono: el costo va aparte y el neto es informativo (sin errores de coma flotante)', () => {
    const t = totalesDeSeleccion([envio('1', { abono: 0.1, costo_envio: 0.2 }), envio('2', { abono: 0.2, costo_envio: 0.1 })])
    expect(t).toEqual({ cantidad: 2, efectivoCobrado: 0.3, costoEnvios: 0.3, totalARendir: 0.3, neto: 0 })
    expect(totalesDeSeleccion([])).toEqual({ cantidad: 0, efectivoCobrado: 0, costoEnvios: 0, totalARendir: 0, neto: 0 })
  })

  it('agrupa mensajeros sin distinguir mayúsculas ni espacios sobrantes', () => {
    expect(mensajerosDeSeleccion([envio('1'), envio('2', { mensajero: ' MOTO 1 ' })])).toEqual(['Moto 1'])
    expect(mensajerosDeSeleccion([envio('1'), envio('2', { mensajero: 'Moto 2' })])).toEqual(['Moto 1', 'Moto 2'])
  })

  it('solo se rinde lo enviado, sin rendir y con permiso', () => {
    expect(esRendible(envio('1'))).toBe(true)
    expect(esRendible(envio('1', { enviado: false }))).toBe(false)
    expect(esRendible(envio('1', { rendido: true }))).toBe(false)
    expect(esRendible(envio('1', { puede_rendir: false }))).toBe(false)
  })

  it('rendir convierte los totales a número y no llama a la base sin ids', async () => {
    mocks.rpc.mockResolvedValue({ data: { cantidad: '2', mensajero: 'Moto 1', total_abono: '20000.50', total_costo: '7000', neto: '13000.50', total_cobrado: '18000' }, error: null })
    const r = await rendirEnviosMoto(['1', '2'])
    expect(mocks.rpc).toHaveBeenCalledWith('rendir_envios_moto', { p_ids: ['1', '2'] })
    expect(r).toEqual({ cantidad: 2, mensajero: 'Moto 1', total_abono: 20000.5, total_costo: 7000, neto: 13000.5, total_cobrado: 18000 })
    await expect(rendirEnviosMoto([])).rejects.toThrow(/No hay envíos/)
  })

  it('todo ya rendido: cantidad 0 y mensajero nulo', async () => {
    mocks.rpc.mockResolvedValue({ data: { cantidad: 0, mensajero: null, total_abono: 0, total_costo: 0, neto: 0 }, error: null })
    expect(await rendirEnviosMoto(['1'])).toEqual({ cantidad: 0, mensajero: null, total_abono: 0, total_costo: 0, neto: 0, total_cobrado: 0 })
  })

  it('el resumen trae monto y entregas; sin fila, ceros', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ monto: '92800', entregas: '2' }], error: null })
    expect(await resumenMotosSinRendir('e-1')).toEqual({ monto: 92800, entregas: 2 })
    expect(mocks.rpc).toHaveBeenCalledWith('resumen_motos_sin_rendir', { p_empresa_id: 'e-1' })
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await resumenMotosSinRendir(null)).toEqual({ monto: 0, entregas: 0 })
  })
})

describe('RendicionMotosDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  const abrir = (envios: EnvioMoto[]) => {
    const props = { onCerrar: vi.fn(), onRendido: vi.fn() }
    render(<RendicionMotosDialog open envios={envios} {...props} />)
    return props
  }
  const valor = (etiqueta: string) => within(screen.getByRole('dialog')).getByText(etiqueta).nextElementSibling?.textContent

  it('muestra cantidad, efectivo cobrado, costo de envíos, total y neto', () => {
    abrir([envio('1'), envio('2', { abono: 5000, costo_envio: 1000 })])
    expect(valor('Entregas')).toBe('2')
    expect(valor('Efectivo cobrado')).toBe('$ 15.000')
    expect(valor('Costo de envíos')).toBe('$ 4.500')
    expect(valor('Total a rendir')).toBe('$ 15.000')
    expect(valor('Neto')).toBe('$ 10.500')
    expect(valor('Mensajero')).toBe('Moto 1')
  })

  it('confirma con los ids y entrega el resultado de la base', async () => {
    const resultado = { cantidad: 2, mensajero: 'Moto 1', total_abono: 15000, total_costo: 4500, neto: 10500, total_cobrado: 15000 }
    mocks.rpc.mockResolvedValue({ data: resultado, error: null })
    const { onRendido } = abrir([envio('1'), envio('2', { abono: 5000, costo_envio: 1000 })])
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rendición' }))
    await waitFor(() => expect(onRendido).toHaveBeenCalledWith(resultado))
    expect(mocks.rpc).toHaveBeenCalledWith('rendir_envios_moto', { p_ids: ['1', '2'] })
  })

  it('mensajeros mezclados (aun con otras mayúsculas): avisa y bloquea la confirmación', () => {
    abrir([envio('1'), envio('2', { mensajero: 'Moto 2' })])
    expect(screen.getByText(/mezcla mensajeros \(Moto 1, Moto 2\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar rendición' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rendición' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('el mismo mensajero con otras mayúsculas o espacios NO bloquea', () => {
    abrir([envio('1'), envio('2', { mensajero: '  moto 1 ' })])
    expect(screen.queryByText(/mezcla mensajeros/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar rendición' })).toBeEnabled()
  })

  it('si la base rechaza el lote muestra el motivo y no lo da por rendido', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Hay un envío que no está enviado.' } })
    const { onRendido } = abrir([envio('1')])
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rendición' }))
    expect(await screen.findByText('Hay un envío que no está enviado.')).toBeInTheDocument()
    expect(onRendido).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar rendición' })).toBeEnabled()
  })

  it('un dato crudo de la base no llega a la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'relation "dominio.envios_moto" exploded' } })
    abrir([envio('1')])
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rendición' }))
    expect(await screen.findByText('No pudimos rendir las entregas. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/exploded/)).not.toBeInTheDocument()
  })

  it('«Cancelar» cierra sin rendir', () => {
    const { onCerrar } = abrir([envio('1')])
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir([envio('1'), envio('2', { mensajero: 'Moto 2' })])
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
