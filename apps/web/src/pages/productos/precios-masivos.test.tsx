import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  useNivelSeccion: vi.fn(),
  useCategorias: vi.fn(),
  descargarCsv: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: () => ({ isSuperadmin: false, isLoading: false }) }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../../lib/rolActual', () => ({ resolverRolId: async () => 'consulta', etiquetaDeRol: () => 'Consulta' }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/migracionCsv', async (original) => ({
  ...(await original<typeof import('../../lib/migracionCsv')>()),
  descargarCsv: mocks.descargarCsv,
}))

import { PreciosMasivos } from './precios-masivos'

const VERSION = '2026-11-07T10:00:00.123456+00:00'

const VISTA = {
  afectados: 2,
  sin_cambio: 1,
  con_error: 0,
  filas: [
    { fila: null, producto_id: 'p-1', sku: 'MA-1', nombre: 'Joystick', moneda: 'ARS', lista_antes: 100, lista_despues: 110, costo_antes: 60, costo_despues: 66, actualizado: VERSION, error: null, cambia: true },
    { fila: null, producto_id: 'p-2', sku: 'MA-2', nombre: 'Cable', moneda: 'ARS', lista_antes: 50, lista_despues: 55, costo_antes: 20, costo_despues: 22, actualizado: VERSION, error: null, cambia: true },
    { fila: null, producto_id: 'p-3', sku: 'MA-3', nombre: 'Funda', moneda: 'ARS', lista_antes: 10, lista_despues: 10, costo_antes: null, costo_despues: null, actualizado: VERSION, error: null, cambia: false },
  ],
}

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'rentabilidad' ? rentabilidad : productos,
    isLoading: false,
  }))

const abrir = () => render(<MemoryRouter><PreciosMasivos /></MemoryRouter>)

function archivoCsv(contenido: string, nombre = 'precios.csv') {
  const archivo = new File([contenido], nombre, { type: 'text/csv' })
  Object.defineProperty(archivo, 'arrayBuffer', { value: async () => new TextEncoder().encode(contenido).buffer })
  return archivo
}

const porcentaje = (texto: string) =>
  fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: texto } })

describe('PreciosMasivos (F-PRE-10, FR-001, FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    niveles('edicion', 'ninguno')
    mocks.useCategorias.mockReturnValue({
      categorias: [
        { id: 'cat-1', nombre: 'Accesorios', padre_id: null, posicion: 0, empresa_ids: [] },
        { id: 'cat-2', nombre: 'Cables', padre_id: 'cat-1', posicion: 0, empresa_ids: [] },
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'previsualizar_actualizacion_precios') return { data: VISTA, error: null }
      return { data: { lote_id: 'l-1', aplicados: 2, repetido: false }, error: null }
    })
  })

  it('sin productos en edición muestra «No tenés acceso» y no monta la pantalla', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    expect(await screen.findByText('No tenés acceso a esta sección')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver vista previa' })).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('modo porcentaje: pide la vista previa con lo elegido y la muestra antes → después', async () => {
    abrir()
    fireEvent.mouseDown(screen.getByLabelText('Alcance'))
    fireEvent.click(await screen.findByRole('option', { name: 'Accesorios > Cables' }))
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_actualizacion_precios', {
      p_modo: 'porcentaje',
      p_parametros: { cambia: 'precio_lista', alcance: 'cat-2', porcentaje: 10 },
    }))
    const tabla = await screen.findByRole('table', { name: 'Vista previa de la actualización de precios' })
    expect(within(tabla).getByText('100,00 → 110,00 ARS')).toBeInTheDocument()
    expect(within(tabla).getByText('10,00 ARS (sin cambio)')).toBeInTheDocument()
    expect(screen.getByText('2 se actualizan')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('aplicar_actualizacion_precios', expect.anything())
  })

  it('la vista previa carga por tandas: 25 y «Cargar más» suma las siguientes, sin paginación', async () => {
    const filas = Array.from({ length: 60 }, (_, i) => ({
      fila: null, producto_id: `p-${i}`, sku: `SKU-${i}`, nombre: `Producto ${i}`, moneda: 'ARS', lista_antes: 100, lista_despues: 110,
      costo_antes: null, costo_despues: null, actualizado: VERSION, error: null, cambia: true,
    }))
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === 'previsualizar_actualizacion_precios'
        ? { data: { afectados: 60, sin_cambio: 0, con_error: 0, filas }, error: null }
        : { data: { lote_id: 'l-1', aplicados: 60, repetido: false }, error: null })
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    const tabla = await screen.findByRole('table', { name: 'Vista previa de la actualización de precios' })
    expect(within(tabla).getAllByRole('row')).toHaveLength(26)
    expect(screen.getByText('Mostrando 25 de 60')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next page|Go to next page|página siguiente/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(screen.getByText('Mostrando 50 de 60')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(screen.getByText('Mostrando 60 de 60')).toBeInTheDocument())
    expect(within(screen.getByRole('table', { name: 'Vista previa de la actualización de precios' })).getAllByRole('row')).toHaveLength(61)
  })

  it('si la base rechaza la vista previa por el tope de 5.000 productos, lo informa', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: null, error: { code: '54000', message: 'La actualización admite hasta 5.000 productos por vez; elegí una categoría' } }))
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('La actualización admite hasta 5.000 productos por vez; elegí una categoría')).toBeInTheDocument()
  })

  it('un porcentaje inválido no permite pedir la vista previa', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeDisabled()
    porcentaje('-100')
    expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeDisabled()
    expect(screen.getByText(/mayor a −100/)).toBeInTheDocument()
    porcentaje('-5,5')
    expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeEnabled()
  })

  it('sin Rentabilidad oculta el costo: ni opción para cambiarlo ni columna', async () => {
    abrir()
    fireEvent.mouseDown(screen.getByLabelText('Qué cambia'))
    const opciones = await screen.findAllByRole('option')
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(['Precio de lista'])
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    const tabla = await screen.findByRole('table', { name: 'Vista previa de la actualización de precios' })
    expect(within(tabla).queryByRole('columnheader', { name: 'Costo' })).not.toBeInTheDocument()
  })

  it('con Rentabilidad en edición ofrece cambiar el costo y lo muestra en la vista previa', async () => {
    niveles('edicion', 'edicion')
    abrir()
    fireEvent.mouseDown(screen.getByLabelText('Qué cambia'))
    expect((await screen.findAllByRole('option')).map((opcion) => opcion.textContent))
      .toEqual(['Precio de lista', 'Costo', 'Costo y precio de lista'])
    fireEvent.click(screen.getByRole('option', { name: 'Costo y precio de lista' }))
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    const tabla = await screen.findByRole('table', { name: 'Vista previa de la actualización de precios' })
    expect(within(tabla).getByRole('columnheader', { name: 'Costo' })).toBeInTheDocument()
    expect(within(tabla).getByText('60,00 → 66,00 ARS')).toBeInTheDocument()
  })

  it('confirma con diálogo y envía las versiones de la vista previa con una clave de operación', async () => {
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    await screen.findByText('Vista previa')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar actualización' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Aplicar la actualización?' })
    expect(within(dialogo).getByText(/Se van a actualizar 2 productos/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('aplicar_actualizacion_precios', {
      p_modo: 'porcentaje',
      p_parametros: { cambia: 'precio_lista', alcance: 'todos', porcentaje: 10, versiones: { 'p-1': VERSION, 'p-2': VERSION, 'p-3': VERSION } },
      p_clave: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    expect(await screen.findByText('Listo: se actualizaron 2 productos.')).toBeInTheDocument()
  })

  it('un conflicto de edición no aplica nada y pide repetir la vista previa', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === 'previsualizar_actualizacion_precios'
        ? { data: VISTA, error: null }
        : { data: null, error: { code: '40001', message: 'otro' } })
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    await screen.findByText('Vista previa')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar actualización' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Aplicar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Un producto cambió desde la vista previa')
    expect(screen.queryByText(/Listo: se actualizaron/)).not.toBeInTheDocument()
  })

  it('con filas con error no se puede confirmar y se muestran por fila', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        afectados: 0, sin_cambio: 0, con_error: 1,
        filas: [{ fila: 4, producto_id: null, sku: 'NO-EXISTE', nombre: null, moneda: null, lista_antes: null, lista_despues: null, actualizado: null, error: 'No existe un producto con ese SKU', cambia: false }],
      },
      error: null,
    })
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('No existe un producto con ese SKU')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar actualización' })).toBeDisabled()
    expect(screen.getByText(/Hay filas con error/)).toBeInTheDocument()
  })

  it('estado de carga mientras genera la vista previa', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByLabelText('Cargando contenido')).toBeInTheDocument()
    resolver({ data: VISTA, error: null })
    expect(await screen.findByText('Vista previa')).toBeInTheDocument()
  })

  it('estado de error: informa y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'relation foo failed' } })
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('No pudimos generar la vista previa.')).toBeInTheDocument()
    expect(screen.queryByText(/relation foo/)).not.toBeInTheDocument()
    mocks.rpc.mockResolvedValue({ data: VISTA, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Vista previa')).toBeInTheDocument()
  })

  it('estado vacío cuando el alcance no tiene productos', async () => {
    mocks.rpc.mockResolvedValue({ data: { afectados: 0, sin_cambio: 0, con_error: 0, filas: [] }, error: null })
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    expect(await screen.findByText('No hay productos para actualizar con este alcance.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar actualización' })).toBeDisabled()
  })

  it('es operable con teclado: los controles son botones y campos enfocables', () => {
    abrir()
    const campo = screen.getByLabelText('Porcentaje')
    campo.focus()
    expect(campo).toHaveFocus()
    fireEvent.change(campo, { target: { value: '5' } })
    const boton = screen.getByRole('button', { name: 'Ver vista previa' })
    boton.focus()
    expect(boton).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Por porcentaje' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Por planilla' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('no muestra identificadores técnicos', async () => {
    abrir()
    porcentaje('10')
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    await screen.findByText('Vista previa')
    expect(document.body.textContent).not.toMatch(/p-1|p-2|[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('modo planilla: descarga la plantilla, informa errores por fila y no deja pedir la vista previa', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Por planilla' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar plantilla CSV' }))
    expect(mocks.descargarCsv).toHaveBeenCalledWith('plantilla-actualizacion-precios.csv', 'SKU,costo,precio_lista\n')

    fireEvent.change(screen.getByLabelText('Archivo CSV de precios'), { target: { files: [archivoCsv('SKU,precio_lista\nMA-1,10\n,20\nMA-3,abc\n')] } })
    expect(await screen.findByText('Fila 3: Falta el SKU.')).toBeInTheDocument()
    expect(screen.getByText(/Fila 4: El precio de lista no es un número válido/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeDisabled()
  })

  it('modo planilla: con filas válidas pide la vista previa con las filas numeradas', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Por planilla' }))
    fireEvent.change(screen.getByLabelText('Archivo CSV de precios'), { target: { files: [archivoCsv('SKU;precio_lista\r\nMA-1;12,5\r\n')] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_actualizacion_precios', {
      p_modo: 'planilla',
      p_parametros: { filas: [{ fila: 2, sku: 'MA-1', precio_lista: 12.5 }] },
    }))
    expect(await screen.findByText('Fila')).toBeInTheDocument()
  })

  it('modo planilla: un archivo que no es CSV se informa y no avanza', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Por planilla' }))
    fireEvent.change(screen.getByLabelText('Archivo CSV de precios'), { target: { files: [archivoCsv('x', 'precios.xlsx')] } })
    expect(await screen.findByText(/no es un archivo \.csv/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver vista previa' })).toBeDisabled()
  })
})
