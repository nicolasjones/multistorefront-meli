import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tests de INTEGRACIÓN de la pantalla (varios campos + RPC + esperas). Con la suite shardeada el default de
// 5 s quedaba justo y daba falsos rojos (timeouts) en PRs que no tocaban esta pantalla. Se sube el timeout del
// archivo y las lecturas de campos que dependen de datos async usan `findBy*`.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useCategorias: vi.fn(),
  rpc: vi.fn(),
  producto: vi.fn(),
  costo: vi.fn(),
  imagenes: vi.fn(),
  insertarImagen: vi.fn(),
  eliminarImagen: vi.fn(),
  firmar: vi.fn(),
  subir: vi.fn(),
  quitarArchivo: vi.fn(),
  useNivelSeccion: vi.fn(),
  useProveedoresBasico: vi.fn(),
  useCotizacionInicial: vi.fn(),
  useEmpresas: vi.fn(),
  useAlicuotas: vi.fn(),
  empresasProducto: vi.fn(),
  escalasProducto: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: (tabla: string) => ({
        select: () => ({
          eq: () =>
            tabla === 'producto_imagenes'
              ? { order: () => ({ returns: mocks.imagenes }), returns: mocks.imagenes }
              : tabla === 'producto_empresa'
                ? { returns: mocks.empresasProducto }
                : tabla === 'producto_precios_escala'
                  ? { returns: mocks.escalasProducto }
                  : { maybeSingle: tabla === 'productos' ? mocks.producto : mocks.costo },
        }),
        insert: mocks.insertarImagen,
        delete: () => ({ eq: () => ({ select: mocks.eliminarImagen }) }),
      }),
    }),
    storage: { from: () => ({ createSignedUrls: mocks.firmar, upload: mocks.subir, remove: mocks.quitarArchivo }) },
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../hooks/useCotizacionInicial', () => ({ useCotizacionInicial: mocks.useCotizacionInicial }))
vi.mock('../../hooks/useAlicuotas', () => ({ useAlicuotas: mocks.useAlicuotas }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoEdit } from './edit'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const A21 = { id: 'a21', nombre: '21 %', porcentaje: 21, exento: false }
const A105 = { id: 'a105', nombre: '10,5 %', porcentaje: 10.5, exento: false }
const EXENTO = { id: 'ex', nombre: 'Exento', porcentaje: 0, exento: true }

const CATEGORIAS = [
  { id: 'cat-0', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] },
  { id: 'cat-1', nombre: 'Cableados', padre_id: 'cat-0', posicion: 0, empresa_ids: [] },
]

const PRODUCTO = {
  id: 'p-1', organizacion_id: 'org-1', nombre: 'Joystick', descripcion: null, sku: 'JOY-1', compatible_con: ['PS5'],
  moneda: 'USD', precio_lista: 49.9, activo: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
  proveedor_id: 'prv-2', codigo_proveedor: 'VIEJO-1', codigo_barras: '7790001000015', categoria_id: 'cat-1', alicuota_iva_id: null,
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/productos/p-1/edit']}>
      <Routes>
        <Route path="/productos/:id/edit" element={<ProductoEdit />} />
        <Route path="/" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('ProductoEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCategorias.mockReturnValue({ categorias: CATEGORIAS, isLoading: false, isError: false, refetch: vi.fn() })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion', 'edicion')
    mocks.producto.mockResolvedValue({ data: PRODUCTO, error: null })
    mocks.useCotizacionInicial.mockReturnValue({ cotizacion: null, cargando: false, hayError: false, recargar: vi.fn() })
    mocks.useProveedoresBasico.mockReturnValue({
      proveedores: [
        { id: 'prv-1', razon_social: 'Proveedor Uno SA', activo: true },
        { id: 'prv-2', razon_social: 'Proveedor Viejo SA', activo: false },
      ],
      cargando: false, hayError: false, recargar: vi.fn(),
    })
    mocks.costo.mockResolvedValue({ data: { costo: 20 }, error: null })
    mocks.useAlicuotas.mockReturnValue({ alicuotas: [A21, A105, EXENTO], porId: new Map([[A21.id, A21], [A105.id, A105], [EXENTO.id, EXENTO]]), isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'San Javucho', activa: true }, { id: 'emp-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mocks.empresasProducto.mockResolvedValue({ data: [{ empresa_id: 'emp-1' }], error: null })
    mocks.escalasProducto.mockResolvedValue({ data: [{ escala: 'x5', precio: '40.00' }], error: null })
    mocks.rpc.mockResolvedValue({ data: PRODUCTO, error: null })
    mocks.imagenes.mockResolvedValue({ data: [], error: null })
    mocks.firmar.mockResolvedValue({ data: [], error: null })
    mocks.subir.mockResolvedValue({ error: null })
    mocks.quitarArchivo.mockResolvedValue({ error: null })
    mocks.insertarImagen.mockResolvedValue({ error: null })
    mocks.eliminarImagen.mockResolvedValue({ data: [{ id: 'i-1' }], error: null })
  })

  it('carga el producto y guarda con el updated_at leído (persistencia)', async () => {
    abrir()
    const nombre = await screen.findByLabelText(/^Nombre/)
    expect(nombre).toHaveValue('Joystick')
    expect(screen.getByLabelText('Costo')).toHaveValue('20')
    fireEvent.change(nombre, { target: { value: 'Joystick Pro' } })
    fireEvent.change(screen.getByLabelText(/^Precio de lista/), { target: { value: '59,90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({
          p_id: 'p-1', p_actualizado_en: PRODUCTO.updated_at, p_nombre: 'Joystick Pro', p_precio_lista: 59.9, p_costo: 20,
        }),
      ),
    )
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
  })

  it('conserva el proveedor desactivado ya asignado y reenvía proveedor y código al guardar', async () => {
    abrir()
    expect(await screen.findByLabelText(/^Proveedor$/)).toHaveValue('Proveedor Viejo SA (inactivo)')
    expect(await screen.findByLabelText('Código del proveedor')).toHaveValue('VIEJO-1')
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({ p_proveedor_id: 'prv-2', p_codigo_proveedor: 'VIEJO-1' }),
      ),
    )
  })

  it('carga los precios por escala y guarda solo ellos con guardar_precios_escala (sin tocar actualizar_producto)', async () => {
    abrir()
    expect(await screen.findByLabelText(/^x5 · 5 a 9 u\./)).toHaveValue('40,00')
    expect(screen.getByLabelText(/^x10 · 10 a 49 u\./)).toHaveValue('')
    fireEvent.change(screen.getByLabelText(/^x10 · 10 a 49 u\./), { target: { value: '35,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('guardar_precios_escala', { p_producto: 'p-1', p_x5: 40, p_x10: 35.5, p_x50: null }),
    )
    expect(mocks.rpc).not.toHaveBeenCalledWith('actualizar_producto', expect.anything())
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
  })

  it('un precio por escala inválido no viaja y deja el error en el campo', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText(/^x50 · 50 u\. o más/), { target: { value: '-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Ingresá un precio de cero o más/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('si fallan los precios por escala el producto queda guardado y se ofrece reintentar', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === 'guardar_precios_escala' ? { data: null, error: { code: '42501', message: 'x' } } : { data: PRODUCTO, error: null },
    )
    abrir()
    fireEvent.change(await screen.findByLabelText(/^x10 · 10 a 49 u\./), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/no pudimos guardar los precios por escala/)).toBeInTheDocument()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar precios por escala' }))
    await waitFor(() => expect(screen.queryByText(/no pudimos guardar los precios por escala/)).not.toBeInTheDocument())
  })

  it('muestra el código de barras y lo reenvía al guardar', async () => {
    abrir()
    const campo = await screen.findByLabelText('Código de barras (EAN-13)')
    expect(campo).toHaveValue('7790001000015')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({ p_codigo_barras: '7790001000015', p_cambiar_codigo_barras: true }),
      ),
    )
  })

  it('vaciar el código de barras viaja nulo', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Código de barras (EAN-13)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', expect.objectContaining({ p_codigo_barras: null })),
    )
  })

  it('un código de barras que no tiene 13 dígitos no se envía', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText('Código de barras (EAN-13)'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Ingresá 13 dígitos, sin espacios ni guiones.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('actualizar_producto', expect.anything())
  })

  it('quitar el proveedor borra el código y viaja nulo', async () => {
    abrir()
    const selector = await screen.findByLabelText(/^Proveedor$/)
    fireEvent.change(selector, { target: { value: '' } })
    expect(selector).toHaveValue('')
    expect(await screen.findByLabelText('Código del proveedor')).toHaveValue('')
    expect(await screen.findByLabelText('Código del proveedor')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({ p_proveedor_id: null, p_codigo_proveedor: null }),
      ),
    )
  })

  it('con cambios sin guardar, cancelar pide «Descartar cambios»', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText(/^Nombre/), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('dialog', { name: 'Descartar cambios' })).toBeInTheDocument()
  })

  it('ante un conflicto avisa, conserva lo escrito y permite recargar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    abrir()
    const nombre = await screen.findByLabelText(/^Nombre/)
    fireEvent.change(nombre, { target: { value: 'Mi cambio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó este producto/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Mi cambio')
    mocks.producto.mockResolvedValue({ data: { ...PRODUCTO, nombre: 'Del otro', updated_at: '2026-01-02T00:00:00+00:00' }, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Recargar producto' }))
    await waitFor(() => expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Del otro'))
  })

  it('sin acceso a Rentabilidad oculta el costo y no lo consulta ni lo envía', async () => {
    niveles('edicion', 'ninguno')
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.queryByLabelText('Costo')).not.toBeInTheDocument()
    expect(mocks.costo).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', expect.objectContaining({ p_costo: null })))
  })

  it('con lectura en Rentabilidad muestra el costo de solo lectura', async () => {
    niveles('edicion', 'lectura')
    abrir()
    expect(await screen.findByLabelText('Costo')).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', expect.objectContaining({ p_costo: null })))
  })

  it('con solo lectura muestra la ficha sin acción de guardar', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    expect(await screen.findByLabelText(/^Nombre/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument()
  })

  it('un producto inexistente o de otra organización se informa', async () => {
    mocks.producto.mockResolvedValue({ data: null, error: null })
    abrir()
    expect(await screen.findByText('Producto no encontrado')).toBeInTheDocument()
  })

  it('un error de carga permite reintentar', async () => {
    mocks.producto.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar el producto.', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Joystick')
  })

  it('muestra el estado y desactiva con la RPC; recarga la ficha para tomar el updated_at nuevo', async () => {
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    mocks.producto.mockResolvedValue({ data: { ...PRODUCTO, activo: false, updated_at: '2026-01-02T10:00:00+00:00' }, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    expect(await screen.findByText('Inactivo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar Joystick' })).toBeInTheDocument()
  })

  it.each([
    ['P0002', 'El producto ya no existe o no pertenece a tu organización.'],
    [undefined, 'No pudimos desactivar el producto. Intentá de nuevo.'],
  ])('si la RPC de estado falla (%s) muestra la alerta en castellano', async (code, mensaje) => {
    abrir()
    await screen.findByLabelText(/^Nombre/)
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje)
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('con solo lectura muestra el estado pero no la acción de activar/desactivar', async () => {
    niveles('lectura', 'lectura')
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
  })

  const IMAGENES = [
    { id: 'i-1', posicion: 1, ruta: 'org-1/p-1/a.png' },
    { id: 'i-2', posicion: 2, ruta: 'org-1/p-1/b.png' },
  ]
  const conImagenes = () => {
    mocks.imagenes.mockResolvedValue({ data: IMAGENES, error: null })
    mocks.firmar.mockResolvedValue({
      data: IMAGENES.map((imagen) => ({ path: imagen.ruta, signedUrl: `https://firmada/${imagen.ruta}`, error: null })),
      error: null,
    })
  }

  it('muestra las imágenes con URL firmada y marca la primera como principal', async () => {
    conImagenes()
    abrir()
    const principal = await screen.findByRole('img', { name: 'Imagen 1 (principal)' })
    expect(principal).toHaveAttribute('src', 'https://firmada/org-1/p-1/a.png')
    expect(screen.getByText('Principal')).toBeInTheDocument()
    expect(mocks.firmar).toHaveBeenCalledWith(['org-1/p-1/a.png', 'org-1/p-1/b.png'], 300)
  })

  it('quitar la principal elimina fila y archivo al guardar y promueve a la siguiente', async () => {
    conImagenes()
    abrir()
    await screen.findByRole('img', { name: 'Imagen 1 (principal)' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal)' })).toHaveAttribute('src', 'https://firmada/org-1/p-1/b.png')
    expect(mocks.eliminarImagen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.eliminarImagen).toHaveBeenCalledTimes(1)
    expect(mocks.quitarArchivo).toHaveBeenCalledWith(['org-1/p-1/a.png'])
  })

  it('una imagen nueva toma la primera posición libre', async () => {
    conImagenes()
    mocks.eliminarImagen.mockResolvedValue({ data: [{ id: 'i-1' }], error: null })
    abrir()
    await screen.findByRole('img', { name: 'Imagen 1 (principal)' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    fireEvent.change(screen.getByTestId('entrada-imagenes'), { target: { files: [new File(['x'], 'nueva.webp', { type: 'image/webp' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.insertarImagen).toHaveBeenCalledWith(expect.objectContaining({ producto_id: 'p-1', organizacion_id: 'org-1', posicion: 1 }))
  })

  it('si no se pudo eliminar la fila no se borra el archivo y se avisa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    conImagenes()
    mocks.eliminarImagen.mockResolvedValue({ data: [], error: null })
    abrir()
    await screen.findByRole('img', { name: 'Imagen 1 (principal)' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar imagen 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('No pudimos quitar la imagen 1.')).toBeInTheDocument()
    expect(mocks.quitarArchivo).not.toHaveBeenCalled()
  })

  it('con solo lectura se ven las imágenes sin quitar ni agregar', async () => {
    niveles('lectura', 'ninguno')
    conImagenes()
    abrir()
    expect(await screen.findByRole('img', { name: 'Imagen 1 (principal)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar imagen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar imágenes' })).not.toBeInTheDocument()
  })

  it('carga las empresas del producto y guarda solo el cambio de empresas sin tocar actualizar_producto', async () => {
    abrir()
    expect(await screen.findByRole('switch', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Mundo JC' })).not.toBeChecked()
    expect(screen.getByText('Visible en San Javucho.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Mundo JC' }))
    expect(screen.getByText('Visible en San Javucho y Mundo JC.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('definir_empresas_producto', { p_producto_id: 'p-1', p_empresa_ids: ['emp-1', 'emp-2'] })
    expect(mocks.rpc).not.toHaveBeenCalledWith('actualizar_producto', expect.anything())
  })

  it('si el producto no tiene empresas lo dice y, sin cambios en ellas, no llama a la RPC de empresas', async () => {
    mocks.empresasProducto.mockResolvedValue({ data: [], error: null })
    abrir()
    expect(await screen.findByText('No se muestra en ninguna store: el producto no aparece en el catálogo público.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('definir_empresas_producto', expect.anything())
  })

  it('si fallan las empresas, los datos quedan guardados y se ofrece reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fallar = true
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre !== 'definir_empresas_producto') return Promise.resolve({ data: PRODUCTO, error: null })
      return Promise.resolve(fallar ? { data: null, error: { code: '57014', message: 'boom interno' } } : { data: 1, error: null })
    })
    abrir()
    fireEvent.click(await screen.findByRole('switch', { name: 'San Javucho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(screen.getByText(/no pudimos guardar las empresas que lo venden/)).toBeInTheDocument()
    expect(screen.queryByText(/boom interno/)).not.toBeInTheDocument()
    fallar = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar empresas' }))
    await waitFor(() => expect(screen.queryByText(/no pudimos guardar las empresas que lo venden/)).not.toBeInTheDocument())
  })

  it('con solo lectura las empresas se ven pero no se pueden cambiar', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    const interruptor = await screen.findByRole('switch', { name: 'San Javucho' })
    expect(interruptor).toBeChecked()
    expect(interruptor).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Mundo JC' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('carga la categoría actual y guarda solo el cambio de categoría con asignar_categoria_producto (F-CAT-08)', async () => {
    abrir()
    const selector = await screen.findByRole('combobox', { name: 'Categoría' })
    expect(selector).toHaveTextContent('Joysticks > Cableados')
    fireEvent.mouseDown(selector)
    fireEvent.click(screen.getByRole('option', { name: 'Sin categoría' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('asignar_categoria_producto', { p_producto_id: 'p-1', p_categoria_id: null })
    expect(mocks.rpc).not.toHaveBeenCalledWith('actualizar_producto', expect.anything())
  })

  it('el IVA hereda de la categoría y cambiarlo guarda solo asignar_alicuota_producto (F-PRE-12)', async () => {
    abrir()
    const selector = await screen.findByRole('combobox', { name: 'IVA' })
    expect(selector).toHaveTextContent('Heredar de la categoría')
    fireEvent.mouseDown(selector)
    fireEvent.click(screen.getByRole('option', { name: '10,5 %' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('asignar_alicuota_producto', { p_producto: 'p-1', p_alicuota: 'a105' })
    expect(mocks.rpc).not.toHaveBeenCalledWith('actualizar_producto', expect.anything())
  })

  it('si falla el IVA, los datos quedan guardados y se ofrece reintentar', async () => {
    let fallar = true
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(nombre === 'asignar_alicuota_producto' && fallar ? { data: null, error: { code: '42501', message: 'raw' } } : { data: null, error: null }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'IVA' }))
    fireEvent.click(screen.getByRole('option', { name: 'Exento' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Los datos se guardaron, pero no pudimos guardar el IVA.')).toBeInTheDocument()
    fallar = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar IVA' }))
    await waitFor(() => expect(screen.queryByText('Los datos se guardaron, pero no pudimos guardar el IVA.')).not.toBeInTheDocument())
  })

  it('sin cambiar el IVA no llama a la RPC de IVA', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('asignar_alicuota_producto', expect.anything())
  })

  it('sin cambiar la categoría no llama a la RPC de categoría', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('asignar_categoria_producto', expect.anything())
  })

  it('si falla la categoría, los datos quedan guardados y se ofrece reintentar', async () => {
    let fallar = true
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre !== 'asignar_categoria_producto') return Promise.resolve({ data: PRODUCTO, error: null })
      return Promise.resolve(fallar ? { data: null, error: { code: '57014', message: 'boom interno' } } : { data: null, error: null })
    })
    abrir()
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Categoría' }))
    fireEvent.click(screen.getByRole('option', { name: 'Joysticks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
    expect(screen.getByText(/no pudimos guardar la categoría/)).toBeInTheDocument()
    expect(screen.queryByText(/boom interno/)).not.toBeInTheDocument()
    fallar = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar categoría' }))
    await waitFor(() => expect(screen.queryByText(/no pudimos guardar la categoría/)).not.toBeInTheDocument())
  })

  it('con solo lectura la categoría se ve pero no se puede cambiar', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    const selector = await screen.findByRole('combobox', { name: 'Categoría' })
    expect(selector).toHaveAttribute('aria-disabled', 'true')
  })
})
