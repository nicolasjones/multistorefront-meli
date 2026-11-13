import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({
  aplicar: vi.fn(),
  recargar: vi.fn(),
  useAplicarCotizacion: vi.fn(),
  usePrevisualizarImpactoDolar: vi.fn(),
}))
vi.mock('../../hooks/useCotizacion', () => ({ useAplicarCotizacion: mocks.useAplicarCotizacion }))
vi.mock('../../hooks/usePrevisualizarImpactoDolar', () => ({ usePrevisualizarImpactoDolar: mocks.usePrevisualizarImpactoDolar }))

import { DialogoCargarDolarConImpacto } from './DialogoCargarDolarConImpacto'

const VIGENTE = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }
const ETIQUETA = 'Dólar del día (pesos por dólar)'
const EMPRESAS = [
  { empresaId: 'e1', nombre: 'Mundo JC', precios: 38 },
  { empresaId: 'e2', nombre: 'San Javucho', precios: 22 },
]
const MUESTRA = [
  { producto: 'Joystick Pro', sku: '5134a', usd: 19.92, porEmpresa: [{ empresaId: 'e1', hoy: 29190, nuevo: 30650 }, { empresaId: 'e2', hoy: 31000, nuevo: 32550 }] },
]
const previaCon = (variacionPct: number, recalcula = true) => ({
  previa: { variacionPct, recalcula, umbralPct: 1, confirmacionPct: 15, redondeoPesos: 10, empresas: EMPRESAS, muestra: MUESTRA },
  anterior: null,
  cargando: false,
  hayError: false,
  recargar: mocks.recargar,
})
const sinPrevia = { previa: null, anterior: null, cargando: false, hayError: false, recargar: mocks.recargar }

const abrir = (props: Partial<Parameters<typeof DialogoCargarDolarConImpacto>[0]> = {}) => render(
  <DialogoCargarDolarConImpacto abierto vigente={VIGENTE} onCerrar={vi.fn()} onConfirmada={vi.fn()} {...props} />,
)
const escribir = (texto: string) => fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: texto } })
const guardar = () => screen.getByRole('button', { name: /Aplicar y recalcular|Registrar cotización/ })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useAplicarCotizacion.mockReturnValue({ aplicar: mocks.aplicar, enviando: false })
  mocks.usePrevisualizarImpactoDolar.mockReturnValue(sinPrevia)
  mocks.aplicar.mockResolvedValue({ ok: true, confirmada: { id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 } })
})

describe('Diálogo «Cargar dólar del día» de Inicio (F-INI-07)', () => {
  it('muestra la cotización vigente y no guarda nada al abrir (CA-INI-07-1)', () => {
    abrir()
    expect(screen.getByLabelText(ETIQUETA)).toBeInTheDocument()
    expect(screen.getByText(/Cotización vigente/)).toBeInTheDocument()
    expect(mocks.aplicar).not.toHaveBeenCalled()
    expect(guardar()).toBeDisabled()
  })

  it('+5 %: chip de variación y una tarjeta de impacto por tienda, sin pedir confirmación (CA-INI-07-2)', () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    abrir()
    escribir('1538,25')
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(1538.25, null)
    expect(screen.getByText(/\+5/)).toBeInTheDocument()
    expect(screen.getByText('38 precios')).toBeInTheDocument()
    expect(screen.getByText('22 precios')).toBeInTheDocument()
    expect(screen.getAllByText(/Mundo JC/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/San Javucho/).length).toBeGreaterThan(0)
    expect(screen.getByRole('table', { name: /precio de hoy y el nuevo/ })).toBeInTheDocument()
    expect(screen.queryByText('Variación inusual')).not.toBeInTheDocument()
    expect(guardar()).toBeEnabled()
  })

  it('una tienda más suma su tarjeta sin cambios de código (CA-INI-07-2)', () => {
    const conTres = previaCon(5)
    conTres.previa.empresas = [...EMPRESAS, { empresaId: 'e3', nombre: 'Tienda Nueva', precios: 5 }]
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(conTres)
    abrir()
    escribir('1538,25')
    expect(screen.getByText('Tienda Nueva')).toBeInTheDocument()
    expect(screen.getByText('5 precios')).toBeInTheDocument()
  })

  it('+20 %: advierte y exige confirmar explícitamente antes de guardar (CA-INI-07-3)', async () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(20))
    abrir()
    escribir('1758')
    expect(screen.getByText('Variación inusual')).toBeInTheDocument()
    expect(guardar()).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el valor/ }))
    expect(guardar()).toBeEnabled()
    fireEvent.click(guardar())
    await waitFor(() => expect(mocks.aplicar).toHaveBeenCalledWith(1758, null, 20))
  })

  it('cambiar el valor vuelve a pedir la confirmación explícita', () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(20))
    abrir()
    escribir('1758')
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el valor/ }))
    expect(guardar()).toBeEnabled()
    escribir('1759')
    expect(guardar()).toBeDisabled()
  })

  it('+0,5 %: informa que no se recalculan precios y solo registra (CA-INI-07-4)', () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(0.5, false))
    abrir()
    escribir('1472')
    expect(screen.getByText('Sin recálculo')).toBeInTheDocument()
    expect(screen.queryByText('Qué va a cambiar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar cotización' })).toBeEnabled()
  })

  it('confirmar guarda con la empresa y avisa al dueño (CA-INI-07-5)', async () => {
    const onConfirmada = vi.fn()
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    abrir({ onConfirmada, empresaId: 'e1', nombreEmpresa: 'Mundo JC' })
    expect(screen.getByText(/Cotización de Mundo JC/)).toBeInTheDocument()
    escribir('1538,25')
    fireEvent.click(guardar())
    await waitFor(() => expect(onConfirmada).toHaveBeenCalledWith({ id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 }))
    expect(mocks.aplicar).toHaveBeenCalledWith(1538.25, 'e1', 5)
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(1538.25, 'e1')
  })

  it('cancelar cierra sin guardar nada (CA-INI-07-6)', () => {
    const onCerrar = vi.fn()
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    abrir({ onCerrar })
    escribir('1538,25')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.aplicar).not.toHaveBeenCalled()
  })

  it.each(['0', '0,00', 'abc', ''])('valor «%s»: no pide vista previa ni permite guardar (CA-INI-07-8)', (texto) => {
    abrir()
    escribir(texto)
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(null, null)
    expect(guardar()).toBeDisabled()
    expect(mocks.aplicar).not.toHaveBeenCalled()
  })

  it('un negativo no se corrige en silencio: «-1490» se rechaza con el mensaje de formato (CA-INI-07-8)', () => {
    abrir()
    escribir('-1490')
    expect(screen.getByLabelText(ETIQUETA)).toHaveValue('-1490')
    expect(screen.getByText(/Ingresá un valor válido/)).toBeInTheDocument()
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(null, null)
    expect(guardar()).toBeDisabled()
  })

  it('con valor en cero explica el formato válido', () => {
    abrir()
    escribir('0')
    expect(screen.getByText(/Ingresá un valor válido/)).toBeInTheDocument()
  })

  it('si no se puede aplicar, muestra el motivo y no cierra', async () => {
    const onConfirmada = vi.fn()
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    mocks.aplicar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cargar la cotización del dólar.' })
    abrir({ onConfirmada })
    escribir('1538,25')
    fireEvent.click(guardar())
    expect(await screen.findByText('Tu rol no puede cargar la cotización del dólar.')).toBeInTheDocument()
    expect(onConfirmada).not.toHaveBeenCalled()
  })

  it('«El dólar cambió mientras revisabas»: recalcula y el tilde de revisión NO se hereda (queda sin marcar y no deja aplicar)', async () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(20))
    mocks.aplicar.mockResolvedValue({ ok: false, mensaje: 'El dólar cambió mientras revisabas: revisá de nuevo.', revisar: true })
    abrir()
    escribir('1758')
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el valor/ }))
    expect(guardar()).toBeEnabled()
    fireEvent.click(guardar())
    expect(await screen.findByText(/El dólar cambió mientras revisabas/)).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Revisé el valor/ })).not.toBeChecked()
    expect(guardar()).toBeDisabled()
  })

  it('el doble clic en «Aplicar» guarda una sola vez', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.aplicar.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    abrir()
    escribir('1538,25')
    const formulario = guardar().closest('form') as HTMLFormElement
    fireEvent.submit(formulario)
    fireEvent.submit(formulario)
    expect(mocks.aplicar).toHaveBeenCalledTimes(1)
    resolver({ ok: true, confirmada: { id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 } })
    await waitFor(() => expect(mocks.aplicar).toHaveBeenCalledTimes(1))
  })

  it('un valor que se aleja más de 10 veces de la vigente no pide la vista previa ni deja aplicar', () => {
    abrir()
    escribir('14')
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(null, null)
    expect(screen.getByText(/se aleja más de 10 veces/)).toBeInTheDocument()
    expect(guardar()).toBeDisabled()
    escribir('1490')
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(1490, null)
    expect(screen.queryByText(/se aleja más de 10 veces/)).not.toBeInTheDocument()
  })

  it('mientras llega el impacto del valor nuevo deja el anterior atenuado (sin esqueleto) y no deja aplicar', () => {
    const conAnterior = previaCon(5)
    mocks.usePrevisualizarImpactoDolar.mockReturnValue({ previa: null, anterior: conAnterior.previa, cargando: true, hayError: false, recargar: mocks.recargar })
    abrir()
    escribir('1538')
    expect(screen.getByText('Qué va a cambiar')).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(guardar()).toBeDisabled()
  })

  it('ya cargado hoy: lo indica y avisa que reemplaza la cotización', () => {
    abrir({ yaCargadaHoy: true })
    expect(screen.getByText('Ya se cargó hoy: esto reemplaza la cotización.')).toBeInTheDocument()
  })

  it('sin productos en dólares: lo dice, y una tienda sin precios figura «Sin cambios» en vez de «0 precios»', () => {
    const vacia = previaCon(5)
    vacia.previa.muestra = []
    vacia.previa.empresas = [{ empresaId: 'e1', nombre: 'Mundo JC', precios: 0 }]
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(vacia)
    abrir()
    escribir('1538,25')
    expect(screen.getByText('No hay precios en dólares para mostrar.')).toBeInTheDocument()
    expect(screen.getByText('Sin cambios')).toBeInTheDocument()
    expect(screen.queryByText('0 precios')).not.toBeInTheDocument()
  })

  it('si falla el cálculo del impacto, ofrece reintentar y no deja guardar', () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue({ previa: null, anterior: null, cargando: false, hayError: true, recargar: mocks.recargar })
    abrir()
    escribir('1538,25')
    expect(screen.getByText('No pudimos calcular qué va a cambiar.')).toBeInTheDocument()
    expect(guardar()).toBeDisabled()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(20))
    abrir()
    escribir('1758')
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
