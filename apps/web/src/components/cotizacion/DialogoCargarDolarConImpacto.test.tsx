import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({
  cargar: vi.fn(),
  confirmar: vi.fn(),
  descartar: vi.fn(),
  recargar: vi.fn(),
  useCargarCotizacion: vi.fn(),
  useConfirmarCotizacion: vi.fn(),
  usePrevisualizarImpactoDolar: vi.fn(),
}))
vi.mock('../../hooks/useCotizacion', () => ({
  useCargarCotizacion: mocks.useCargarCotizacion,
  useConfirmarCotizacion: mocks.useConfirmarCotizacion,
}))
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
  cargando: false,
  hayError: false,
  recargar: mocks.recargar,
})
const sinPrevia = { previa: null, cargando: false, hayError: false, recargar: mocks.recargar }

const abrir = (props: Partial<Parameters<typeof DialogoCargarDolarConImpacto>[0]> = {}) => render(
  <DialogoCargarDolarConImpacto abierto vigente={VIGENTE} onCerrar={vi.fn()} onConfirmada={vi.fn()} {...props} />,
)
const escribir = (texto: string) => fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: texto } })
const guardar = () => screen.getByRole('button', { name: /Aplicar y recalcular|Registrar cotización/ })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useCargarCotizacion.mockReturnValue({ cargar: mocks.cargar, enviando: false })
  mocks.useConfirmarCotizacion.mockReturnValue({ confirmar: mocks.confirmar, descartar: mocks.descartar, enviando: false })
  mocks.usePrevisualizarImpactoDolar.mockReturnValue(sinPrevia)
  mocks.cargar.mockResolvedValue({ ok: true, carga: { valor: 1538.25, anterior: 1465, variacionPct: 5, expiraEn: 'x' } })
  mocks.confirmar.mockResolvedValue({ ok: true, confirmada: { id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 } })
  mocks.descartar.mockResolvedValue({ ok: true })
})

describe('Diálogo «Cargar dólar del día» de Inicio (F-INI-07)', () => {
  it('muestra la cotización vigente y no guarda nada al abrir (CA-INI-07-1)', () => {
    abrir()
    expect(screen.getByLabelText(ETIQUETA)).toBeInTheDocument()
    expect(screen.getByText(/Cotización vigente/)).toBeInTheDocument()
    expect(mocks.cargar).not.toHaveBeenCalled()
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
    await waitFor(() => expect(mocks.confirmar).toHaveBeenCalledWith(null, 20))
    expect(mocks.cargar).toHaveBeenCalledWith(1758, null)
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
    expect(mocks.cargar).toHaveBeenCalledWith(1538.25, 'e1')
    expect(mocks.confirmar).toHaveBeenCalledWith('e1', 5)
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(1538.25, 'e1')
  })

  it('cancelar cierra sin guardar nada (CA-INI-07-6)', () => {
    const onCerrar = vi.fn()
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    abrir({ onCerrar })
    escribir('1538,25')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.cargar).not.toHaveBeenCalled()
    expect(mocks.confirmar).not.toHaveBeenCalled()
    expect(mocks.descartar).not.toHaveBeenCalled()
  })

  it.each(['0', '0,00', 'abc', ''])('valor «%s»: no pide vista previa ni permite guardar (CA-INI-07-8)', (texto) => {
    abrir()
    escribir(texto)
    expect(mocks.usePrevisualizarImpactoDolar).toHaveBeenLastCalledWith(null, null)
    expect(guardar()).toBeDisabled()
    expect(mocks.cargar).not.toHaveBeenCalled()
  })

  it('el campo no admite signo negativo: «-5» queda como «5» (CA-INI-07-8)', () => {
    abrir()
    escribir('-5')
    expect(screen.getByLabelText(ETIQUETA)).toHaveValue('5')
  })

  it('con valor en cero explica el formato válido', () => {
    abrir()
    escribir('0')
    expect(screen.getByText(/Ingresá un valor válido/)).toBeInTheDocument()
  })

  it('si no se puede cargar, muestra el motivo y no confirma', async () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(5))
    mocks.cargar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cargar la cotización del dólar.' })
    abrir()
    escribir('1538,25')
    fireEvent.click(guardar())
    expect(await screen.findByText('Tu rol no puede cargar la cotización del dólar.')).toBeInTheDocument()
    expect(mocks.confirmar).not.toHaveBeenCalled()
  })

  it('si la base rechaza al confirmar, descarta lo cargado y recalcula la vista previa', async () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue(previaCon(20))
    mocks.confirmar.mockResolvedValue({ ok: false, mensaje: 'El dólar cambió mientras revisabas: revisá de nuevo.', revisar: true })
    abrir()
    escribir('1758')
    fireEvent.click(screen.getByRole('checkbox', { name: /Revisé el valor/ }))
    fireEvent.click(guardar())
    expect(await screen.findByText(/El dólar cambió mientras revisabas/)).toBeInTheDocument()
    expect(mocks.descartar).toHaveBeenCalledWith(null)
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('si falla el cálculo del impacto, ofrece reintentar y no deja guardar', () => {
    mocks.usePrevisualizarImpactoDolar.mockReturnValue({ previa: null, cargando: false, hayError: true, recargar: mocks.recargar })
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
