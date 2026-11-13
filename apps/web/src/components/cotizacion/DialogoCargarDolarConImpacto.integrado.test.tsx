import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Prueba con los hooks REALES (vista previa con espera y aplicar atómico): solo se simula el cliente de la base,
// para verificar el contrato con las RPC (qué se llama, con qué parámetros y qué NO se llama).
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1' }) }))

import { DialogoCargarDolarConImpacto } from './DialogoCargarDolarConImpacto'

const VIGENTE = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }
const ETIQUETA = 'Dólar del día (pesos por dólar)'
const PREVIA = {
  variacion_pct: 5, recalcula: true, umbral_pct: 1, confirmacion_pct: 15, redondeo_pesos: 10,
  empresas: [{ empresa_id: 'e1', nombre: 'Mundo JC', precios: 38 }],
  muestra: [{ producto: 'Joystick Pro', sku: '5134a', usd: 19.92, por_empresa: [{ empresa_id: 'e1', hoy: 29190, nuevo: 30650, usd: 19.92 }] }],
}
const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([funcion]) => funcion === nombre)

const abrir = (onConfirmada = vi.fn()) => render(
  <DialogoCargarDolarConImpacto abierto vigente={VIGENTE} aplicada={1465} onCerrar={vi.fn()} onConfirmada={onConfirmada} />,
)

beforeEach(() => {
  mocks.rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.rpc.mockImplementation(async (funcion: string) => {
    if (funcion === 'previsualizar_impacto_dolar') return { data: PREVIA, error: null }
    if (funcion === 'aplicar_cotizacion') return { data: { id: 'c1', recalculo_aplicado: true, precios_recalculados: 38 }, error: null }
    return { data: null, error: { code: 'XX000' } }
  })
})

describe('Diálogo del dólar de Inicio · contrato con las RPC (hooks reales)', () => {
  it('muestra el impacto con la RPC de solo lectura y aplica con UNA llamada atómica, sin cargar ni descartar', async () => {
    const onConfirmada = vi.fn()
    abrir(onConfirmada)
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: '1538,25' } })
    expect(await screen.findByText('Qué va a cambiar', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(llamadas('previsualizar_impacto_dolar')).toEqual([['previsualizar_impacto_dolar', { p_valor: 1538.25 }]])
    expect(llamadas('aplicar_cotizacion')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar y recalcular' }))
    await waitFor(() => expect(onConfirmada).toHaveBeenCalledWith({ id: 'c1', recalculoAplicado: true, preciosRecalculados: 38 }))
    expect(llamadas('aplicar_cotizacion')).toEqual([['aplicar_cotizacion', { p_valor: 1538.25, p_variacion_vista: 5 }]])
    expect(llamadas('cargar_cotizacion')).toHaveLength(0)
    expect(llamadas('confirmar_cotizacion')).toHaveLength(0)
    expect(llamadas('descartar_cotizacion')).toHaveLength(0)
  })

  it('si la base rechaza por cambio de variación, muestra el motivo, no deja pendiente y exige revisar de nuevo', async () => {
    const onConfirmada = vi.fn()
    mocks.rpc.mockImplementation(async (funcion: string) => {
      if (funcion === 'previsualizar_impacto_dolar') return { data: { ...PREVIA, variacion_pct: 20 }, error: null }
      return { data: null, error: { code: '22023', hint: 'variacion_cambio' } }
    })
    abrir(onConfirmada)
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: '1758' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: /Revisé el valor/ }, { timeout: 3000 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar y recalcular' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar y recalcular' }))
    expect(await screen.findByText(/El dólar cambió mientras revisabas/)).toBeInTheDocument()
    expect(onConfirmada).not.toHaveBeenCalled()
    expect(llamadas('aplicar_cotizacion')).toEqual([['aplicar_cotizacion', { p_valor: 1758, p_variacion_vista: 20 }]])
    expect(screen.getByRole('checkbox', { name: /Revisé el valor/ })).not.toBeChecked()
    expect(llamadas('descartar_cotizacion')).toHaveLength(0)
  })

  it('al tipear solo pide el impacto del valor final (espera de 400 ms) y un valor absurdo no llama a la base', async () => {
    abrir()
    const campo = screen.getByLabelText(ETIQUETA)
    for (const texto of ['1', '15', '153', '1538']) fireEvent.change(campo, { target: { value: texto } })
    await screen.findByText('Qué va a cambiar', {}, { timeout: 3000 })
    expect(llamadas('previsualizar_impacto_dolar')).toEqual([['previsualizar_impacto_dolar', { p_valor: 1538 }]])
  })
})
