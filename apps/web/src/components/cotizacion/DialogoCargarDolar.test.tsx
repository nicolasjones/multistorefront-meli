import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cargar: vi.fn(),
  confirmar: vi.fn(),
  descartar: vi.fn(),
  recargar: vi.fn(),
  useCargarCotizacion: vi.fn(),
  useConfirmarCotizacion: vi.fn(),
  usePrevisualizarCotizacion: vi.fn(),
}))
vi.mock('../../hooks/useCotizacion', () => ({
  useCargarCotizacion: mocks.useCargarCotizacion,
  useConfirmarCotizacion: mocks.useConfirmarCotizacion,
}))
vi.mock('../../hooks/usePrevisualizarCotizacion', () => ({ usePrevisualizarCotizacion: mocks.usePrevisualizarCotizacion }))

import { DialogoCargarDolar } from './DialogoCargarDolar'

const VIGENTE = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }
const ETIQUETA = 'Dólar del día (pesos por dólar)'
const CARGA = { valor: 1490, anterior: 1465, variacionPct: 1.7065, expiraEn: 'x' }

const PREVIA = {
  variacionPct: 1.7065,
  recalcula: true,
  empresas: [
    { empresaId: 'e1', nombre: 'Mundo JC', precios: 38 },
    { empresaId: 'e2', nombre: 'San Javucho', precios: 22 },
  ],
  muestra: [
    { producto: 'Joystick Pro', sku: '5134a', usd: 19.92, porEmpresa: [{ empresaId: 'e1', hoy: 29190, nuevo: 29690 }, { empresaId: 'e2', hoy: 31000, nuevo: 31500 }] },
  ],
}

const abrir = (props: Partial<Parameters<typeof DialogoCargarDolar>[0]> = {}) => render(
  <DialogoCargarDolar abierto vigente={VIGENTE} onCerrar={vi.fn()} onConfirmada={vi.fn()} {...props} />,
)
const escribir = (texto: string) => fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: texto } })
const previa = (extra: Partial<typeof PREVIA> = {}) => ({ previa: { ...PREVIA, ...extra }, cargando: false, hayError: false, recargar: mocks.recargar })

// Lleva el diálogo al paso 2 (la cotización queda pendiente y se ve la vista previa).
const irAlPaso2 = async () => {
  mocks.cargar.mockResolvedValue({ ok: true, carga: CARGA })
  escribir('1490')
  fireEvent.click(screen.getByRole('button', { name: 'Cargar dólar' }))
  await screen.findByRole('button', { name: /Aplicar y recalcular|Registrar cotización/ })
}

const preparar = () => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useCargarCotizacion.mockReturnValue({ cargar: mocks.cargar, enviando: false })
  mocks.useConfirmarCotizacion.mockReturnValue({ confirmar: mocks.confirmar, descartar: mocks.descartar, enviando: false })
  mocks.usePrevisualizarCotizacion.mockReturnValue(previa())
}

describe('DialogoCargarDolar · paso 1 (carga)', () => {
  beforeEach(preparar)

  it('muestra el campo con $ y «por USD», el anterior y la variación vacía', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Cargar dólar del día' })).toBeInTheDocument()
    expect(screen.getByText('$')).toBeInTheDocument()
    expect(screen.getByText('por USD')).toBeInTheDocument()
    expect(screen.getByText('Anterior: $ 1.465 (vie 25/09)')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeDisabled()
  })

  it('acepta 1490 y 1490,50 y muestra la variación', () => {
    abrir()
    escribir('1490')
    expect(screen.getByText('+1,7 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
    escribir('1490,50')
    expect(screen.getByText('+1,7 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })

  it('el campo solo admite dígitos, punto y coma', () => {
    abrir()
    escribir('14a9$0')
    expect(screen.getByLabelText(ETIQUETA)).toHaveValue('1490')
  })

  it.each(['0', '0,00', '1490.50', ',5'])('«%s» es inválido: muestra el mensaje y no se puede avanzar', (texto) => {
    abrir()
    escribir(texto)
    expect(screen.getByText('Ingresá un valor válido, por ejemplo 1490 o 1490,50.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Cargar dólar' }).closest('form') as HTMLFormElement)
    expect(mocks.cargar).not.toHaveBeenCalled()
  })

  it('avisa «Variación inusual» solo por encima del 15 % y no bloquea', () => {
    abrir()
    escribir('1650')
    expect(screen.queryByText('Variación inusual')).not.toBeInTheDocument()
    escribir('1700')
    expect(screen.getByText('Variación inusual')).toBeInTheDocument()
    expect(screen.getByText(/La variación supera el 15 %/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })

  it('carga el valor y pasa a la vista previa sin cerrar ni confirmar', async () => {
    mocks.cargar.mockResolvedValue({ ok: true, carga: { ...CARGA, valor: 1490.5 } })
    const onConfirmada = vi.fn()
    abrir({ onConfirmada })
    escribir('1490,50')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar dólar' }))
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(1490.5))
    expect(await screen.findByRole('button', { name: 'Aplicar y recalcular' })).toBeInTheDocument()
    expect(onConfirmada).not.toHaveBeenCalled()
    expect(mocks.confirmar).not.toHaveBeenCalled()
  })

  it('muestra el rechazo de la base sin pasar a la vista previa', async () => {
    mocks.cargar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cargar la cotización del dólar.' })
    abrir()
    escribir('1490')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar dólar' }))
    expect(await screen.findByText('Tu rol no puede cargar la cotización del dólar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aplicar y recalcular' })).not.toBeInTheDocument()
  })

  it('se cierra con Cancelar sin descartar nada (todavía no hay pendiente)', () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.descartar).not.toHaveBeenCalled()
  })

  it('se envía con Enter (teclado)', async () => {
    mocks.cargar.mockResolvedValue({ ok: true, carga: CARGA })
    abrir()
    escribir('1490')
    fireEvent.submit(screen.getByLabelText(ETIQUETA).closest('form') as HTMLFormElement)
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(1490))
  })

  it('mientras envía no deja cerrar ni reenviar', () => {
    mocks.useCargarCotizacion.mockReturnValue({ cargar: mocks.cargar, enviando: true })
    abrir()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cargando…' })).toBeDisabled()
  })

  it('sin cotización vigente no inventa un «Anterior» ni una variación', () => {
    abrir({ vigente: null })
    escribir('1490')
    expect(screen.queryByText(/Anterior/)).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })
})

describe('DialogoCargarDolar · paso 2 (vista previa y confirmación)', () => {
  beforeEach(preparar)

  it('sobre el umbral muestra «Qué va a cambiar» por empresa y «Aplicar y recalcular»', async () => {
    abrir()
    await irAlPaso2()
    expect(screen.getByText('$ 1.490')).toBeInTheDocument()
    expect(screen.getByText('+1,7 %')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Qué va a cambiar' })).toBeInTheDocument()
    expect(screen.getByText('38 precios')).toBeInTheDocument()
    expect(screen.getByText('22 precios')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar y recalcular' })).toBeEnabled()
    expect(screen.queryByText('Sin recálculo')).not.toBeInTheDocument()
  })

  it('bajo el umbral avisa «Sin recálculo», oculta el impacto y ofrece «Registrar cotización»', async () => {
    mocks.usePrevisualizarCotizacion.mockReturnValue(previa({ recalcula: false, variacionPct: 0.5 }))
    abrir()
    await irAlPaso2()
    expect(screen.getByText('Sin recálculo')).toBeInTheDocument()
    expect(screen.getByText(/La variación es menor al umbral de 1 %: la cotización queda registrada, pero no se recalculan precios\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Qué va a cambiar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar cotización' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Aplicar y recalcular' })).not.toBeInTheDocument()
  })

  it('mientras calcula la vista previa no se puede confirmar', async () => {
    mocks.usePrevisualizarCotizacion.mockReturnValue({ previa: null, cargando: true, hayError: false, recargar: mocks.recargar })
    abrir()
    await irAlPaso2()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar y recalcular' })).toBeDisabled()
  })

  it('si falla la vista previa muestra el error con «Reintentar» y no deja confirmar', async () => {
    mocks.usePrevisualizarCotizacion.mockReturnValue({ previa: null, cargando: false, hayError: true, recargar: mocks.recargar })
    abrir()
    await irAlPaso2()
    expect(screen.getByText('No pudimos calcular qué va a cambiar.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Aplicar y recalcular' })).toBeDisabled()
  })

  it('«Aplicar y recalcular» confirma y avisa al llamador lo que decidió la base', async () => {
    const confirmada = { id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 }
    mocks.confirmar.mockResolvedValue({ ok: true, confirmada })
    const onConfirmada = vi.fn()
    abrir({ onConfirmada })
    await irAlPaso2()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar y recalcular' }))
    await waitFor(() => expect(onConfirmada).toHaveBeenCalledWith(confirmada))
    expect(mocks.confirmar).toHaveBeenCalledTimes(1)
  })

  it('«Cancelar» descarta la cotización pendiente y cierra', async () => {
    mocks.descartar.mockResolvedValue({ ok: true })
    const onCerrar = vi.fn()
    abrir({ onCerrar })
    await irAlPaso2()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1))
    expect(mocks.descartar).toHaveBeenCalledTimes(1)
    expect(mocks.confirmar).not.toHaveBeenCalled()
  })

  it('si no se pudo descartar, avisa y no cierra', async () => {
    mocks.descartar.mockResolvedValue({ ok: false, mensaje: 'No pudimos descartar la cotización. Intentá de nuevo.' })
    const onCerrar = vi.fn()
    abrir({ onCerrar })
    await irAlPaso2()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText('No pudimos descartar la cotización. Intentá de nuevo.')).toBeInTheDocument()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('una cotización vencida o ya confirmada muestra el error claro y no cierra', async () => {
    mocks.confirmar.mockResolvedValue({ ok: false, mensaje: 'La cotización cargada venció; volvé a cargarla.' })
    const onConfirmada = vi.fn()
    abrir({ onConfirmada })
    await irAlPaso2()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar y recalcular' }))
    expect(await screen.findByText('La cotización cargada venció; volvé a cargarla.')).toBeInTheDocument()
    expect(onConfirmada).not.toHaveBeenCalled()
  })

  it('avisa «Variación inusual» también en la vista previa', async () => {
    mocks.usePrevisualizarCotizacion.mockReturnValue(previa({ variacionPct: 20 }))
    abrir()
    await irAlPaso2()
    expect(screen.getByText('Variación inusual')).toBeInTheDocument()
  })

  it('mientras confirma no deja cancelar ni reenviar (doble clic)', async () => {
    const { rerender } = abrir()
    await irAlPaso2()
    // «enviando» llega por el hook: se vuelve a renderizar con él activo (el paso 2 se conserva).
    mocks.useConfirmarCotizacion.mockReturnValue({ confirmar: mocks.confirmar, descartar: mocks.descartar, enviando: true })
    rerender(<DialogoCargarDolar abierto vigente={VIGENTE} onCerrar={vi.fn()} onConfirmada={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Aplicar y recalcular' })).toBeDisabled()
  })
})
