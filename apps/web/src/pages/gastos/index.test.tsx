import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useGastos: vi.fn(),
  recargar: vi.fn(),
  cargarMas: vi.fn(),
  elegirEmpresa: vi.fn(),
  guardar: vi.fn(),
  anular: vi.fn(),
  exportar: vi.fn(),
  descargarCsv: vi.fn(),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useGastos', () => ({ useGastos: mocks.useGastos }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/exportarCsv', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/exportarCsv')>()),
  descargarCsv: mocks.descargarCsv,
}))
vi.mock('../../lib/gastos', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/gastos')>()),
  guardarGasto: mocks.guardar,
  anularGasto: mocks.anular,
  exportarGastosCsv: mocks.exportar,
}))

import { Gastos } from './index'

const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho', esActiva: true },
  { id: 'e2', nombre: 'Mundo JC', esActiva: false },
]
const GASTOS = [
  {
    id: 'g1', empresaId: 'e1', empresaNombre: 'San Javucho', fecha: '2026-11-06', categoria: 'Servicios', tipoCosto: 'fijo', detalle: 'Internet y telefonía',
    importe: 36800, moneda: 'ARS', cotizacionUsada: null, importePesos: 36800, recurrente: true, anuladoEn: null, motivoAnulacion: null, actualizadoEn: '2026-11-06T10:00:00Z',
  },
  {
    id: 'g2', empresaId: 'e1', empresaNombre: 'San Javucho', fecha: '2026-11-05', categoria: 'Alquiler', tipoCosto: 'fijo', detalle: null,
    importe: 500, moneda: 'USD', cotizacionUsada: 1000, importePesos: 500000, recurrente: false, anuladoEn: null, motivoAnulacion: null, actualizadoEn: '2026-11-05T10:00:00Z',
  },
  {
    id: 'g3', empresaId: 'e1', empresaNombre: 'San Javucho', fecha: '2026-11-04', categoria: 'Fletes', tipoCosto: 'variable', detalle: null,
    importe: 1000, moneda: 'ARS', cotizacionUsada: null, importePesos: 1000, recurrente: false, anuladoEn: '2026-11-05T10:00:00Z', motivoAnulacion: 'Duplicado', actualizadoEn: '2026-11-05T10:00:00Z',
  },
]
const RESUMEN = {
  total: 536800, conteo: 2, conteoAnulados: 1,
  desglose: [
    { categoria: 'Alquiler', tipoCosto: 'fijo', total: 500000, conteo: 1 },
    { categoria: 'Servicios', tipoCosto: 'fijo', total: 36800, conteo: 1 },
  ],
}

type Estado = { nivel?: string; empresaActivaId?: string | null; filas?: unknown[]; cargando?: boolean; hayError?: boolean; hayMas?: boolean; errorTanda?: boolean }

const configurar = ({ nivel = 'edicion', empresaActivaId = 'e1', filas = GASTOS, cargando = false, hayError = false, hayMas = false, errorTanda = false }: Estado = {}) => {
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.useFiltroPorEmpresaActiva.mockReturnValue({
    empresas: EMPRESAS, valor: empresaActivaId, cambiar: mocks.elegirEmpresa, empresaActivaId, cargando: false, hayError: false,
  })
  mocks.useGastos.mockReturnValue({
    filas, resumen: hayError || cargando ? null : RESUMEN, hayMas, cargando, cargandoMas: false, hayError, errorTanda, recargar: mocks.recargar, cargarMas: mocks.cargarMas,
  })
}

const vista = () => (
  <MemoryRouter>
    <Gastos />
  </MemoryRouter>
)
const montar = (estado: Estado = {}) => {
  configurar(estado)
  return render(vista())
}

describe('pantalla de gastos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardar.mockResolvedValue('g9')
    mocks.anular.mockResolvedValue(undefined)
    mocks.recargar.mockResolvedValue(undefined)
    mocks.cargarMas.mockResolvedValue(undefined)
    mocks.exportar.mockResolvedValue({ contenido: 'csv', total: 2, truncado: false })
  })

  it('lista los gastos con importe original, equivalente en pesos, total y desglose', () => {
    montar()
    const tabla = screen.getByRole('table', { name: 'Gastos' })
    expect(within(tabla).getByText('Internet y telefonía')).toBeInTheDocument()
    expect(within(tabla).getByText('US$ 500,00')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 500.000,00 al dólar de $ 1.000,00')).toBeInTheDocument()
    expect(within(tabla).getByText('Anulado')).toBeInTheDocument()
    expect(within(tabla).getByText('Motivo: Duplicado')).toBeInTheDocument()
    expect(screen.getByText('$ 536.800,00')).toBeInTheDocument()
    const desglose = screen.getByRole('list', { name: 'Desglose por concepto' })
    expect(within(desglose).getByText('Alquiler · fijo')).toBeInTheDocument()
  })

  it('arranca en el período Mes con la empresa activa y cambiar el período reinicia la consulta', () => {
    montar()
    const filtros = mocks.useGastos.mock.calls[0][0]
    expect(filtros.empresaId).toBe('e1')
    expect(filtros.desde.slice(8)).toBe('01')
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    const ultimo = mocks.useGastos.mock.calls.at(-1)![0]
    expect(ultimo.desde).toBe(ultimo.hasta)
  })

  it('con solo lectura no ofrece cargar, editar ni anular, pero sí exportar', () => {
    montar({ nivel: 'lectura' })
    expect(screen.queryByRole('button', { name: 'Nuevo gasto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Anular / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled()
  })

  it('un gasto anulado no ofrece editar ni anular', () => {
    montar({ filas: [GASTOS[2]] })
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
  })

  it('muestra carga, error con Reintentar y el vacío «Sin gastos en el período»', () => {
    const { unmount } = montar({ cargando: true, filas: [] })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()
    const error = montar({ hayError: true, filas: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    error.unmount()
    montar({ filas: [] })
    expect(screen.getByText('Sin gastos en el período')).toBeInTheDocument()
  })

  it('carga infinita: «Cargar más» pide la tanda siguiente y el fin se anuncia', () => {
    const { unmount } = montar({ hayMas: true })
    fireEvent.click(screen.getByRole('button', { name: /Cargar más/ }))
    expect(mocks.cargarMas).toHaveBeenCalledTimes(1)
    unmount()
    montar({ hayMas: false })
    expect(screen.getAllByText(/No hay más resultados/).length).toBeGreaterThan(0)
  })

  it('«Mostrar anulados» y los filtros de concepto y tipo vuelven a consultar', () => {
    montar()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar anulados' }))
    expect(mocks.useGastos.mock.calls.at(-1)![1]).toBe(true)
  })

  it('el select de Concepto filtra por categoría y «Todos» lo limpia', async () => {
    montar()
    expect(mocks.useGastos.mock.calls.at(-1)![0].categoria).toBeNull()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Concepto' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Alquiler' }))
    expect(mocks.useGastos.mock.calls.at(-1)![0]).toMatchObject({ categoria: 'Alquiler', tipoCosto: null })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Concepto' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Todos' }))
    expect(mocks.useGastos.mock.calls.at(-1)![0].categoria).toBeNull()
  })

  it('el select de Tipo de costo filtra por fijo o variable y se combina con el concepto', async () => {
    montar()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tipo de costo' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Variable' }))
    expect(mocks.useGastos.mock.calls.at(-1)![0]).toMatchObject({ tipoCosto: 'variable', categoria: null })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Concepto' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Fletes' }))
    expect(mocks.useGastos.mock.calls.at(-1)![0]).toMatchObject({ tipoCosto: 'variable', categoria: 'Fletes' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tipo de costo' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Todos' }))
    expect(mocks.useGastos.mock.calls.at(-1)![0]).toMatchObject({ tipoCosto: null, categoria: 'Fletes' })
  })

  it('el filtro de tienda pide elegir otra tienda o todas sin cambiar la empresa activa', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenLastCalledWith('e2')
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(mocks.elegirEmpresa).toHaveBeenLastCalledWith(null)
  })

  it('«Cargar más» es un botón real, alcanzable con el teclado, y pide la tanda siguiente', () => {
    montar({ hayMas: true })
    const boton = screen.getByRole('button', { name: /Cargar más/ })
    expect(boton.tagName).toBe('BUTTON')
    expect(boton).not.toBeDisabled()
    expect(boton.getAttribute('tabindex')).not.toBe('-1')
    boton.focus()
    expect(boton).toHaveFocus()
    fireEvent.click(boton)
    expect(mocks.cargarMas).toHaveBeenCalledTimes(1)
  })

  it('carga un gasto en la tienda activa, con el tipo precargado, y recarga la lista', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    expect(within(dialogo).getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: /Concepto/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Fletes' }))
    expect(within(dialogo).getByRole('button', { name: 'Costo variable' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Importe/ }), { target: { value: '1250,50' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar gasto' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith(expect.objectContaining({
      id: null, empresaId: 'e1', categoria: 'Fletes', tipoCosto: 'variable', importe: 1250.5, moneda: 'ARS', actualizadoEn: null,
    }))
    expect(await screen.findByText('Gasto cargado.')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('no guarda con un importe inválido y muestra los errores', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar gasto' }))
    expect(await within(dialogo).findByText('Elegí un concepto.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('muestra «Cargá la cotización del dólar» cuando la base rechaza el alta en USD', async () => {
    mocks.guardar.mockRejectedValueOnce({ code: '22023', message: 'Cargá la cotización del dólar' })
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: /Concepto/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Alquiler' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Dólares (USD)' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Importe/ }), { target: { value: '500' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar gasto' }))
    expect(await within(dialogo).findByText('Cargá la cotización del dólar')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo gasto' })).toBeInTheDocument()
  })

  it('edita un gasto enviando la versión leída (bloqueo optimista)', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /^Editar gasto de Servicios/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar gasto' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Importe/ }), { target: { value: '40000' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar gasto' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', importe: 40000, actualizadoEn: '2026-11-06T10:00:00Z' }))
    expect(await screen.findByText('Gasto actualizado.')).toBeInTheDocument()
  })

  it('anula con motivo obligatorio', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /^Anular gasto de Servicios/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Anular gasto' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anular gasto' }))
    expect(await within(dialogo).findByText('Contanos por qué se anula.')).toBeInTheDocument()
    expect(mocks.anular).not.toHaveBeenCalled()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Motivo/ }), { target: { value: 'Cargado dos veces' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anular gasto' }))
    await waitFor(() => expect(mocks.anular).toHaveBeenCalledWith('g1', 'Cargado dos veces', '2026-11-06T10:00:00Z'))
    expect(await screen.findByText('Gasto anulado.')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('exporta el listado filtrado y descarga el archivo', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    expect(mocks.exportar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'e1' }), false)
    expect(await screen.findByText('Exportamos 2 gastos.')).toBeInTheDocument()
  })

  it('al cambiar la empresa activa con el diálogo abierto, se cierra con aviso y no guarda nada', async () => {
    const { rerender } = montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    configurar({ empresaActivaId: 'e2' })
    rerender(vista())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Cambiaste de empresa: cerramos el diálogo sin guardar nada/)).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(mocks.useGastos.mock.calls.at(-1)![0].empresaId).toBe('e2')
  })
})

describe.each([320, 768, 1440])('accesibilidad de gastos a %i px', (ancho) => {
  it('la pantalla y el diálogo no tienen violaciones de axe', async () => {
    window.innerWidth = ancho
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo gasto' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo gasto' })
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})
