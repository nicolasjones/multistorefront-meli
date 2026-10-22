import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCategorias: vi.fn(),
  rpc: vi.fn(),
  insertarImagen: vi.fn(),
  subir: vi.fn(),
  quitarArchivo: vi.fn(),
  leerImagenes: vi.fn(),
  useNivelSeccion: vi.fn(),
  useProveedoresBasico: vi.fn(),
  useCotizacionInicial: vi.fn(),
  useEmpresas: vi.fn(),
  useAlicuotas: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({ from: () => ({
        insert: mocks.insertarImagen,
        select: () => ({ eq: () => ({ order: () => ({ returns: mocks.leerImagenes }) }) }),
      }) }),
    storage: { from: () => ({ upload: mocks.subir, remove: mocks.quitarArchivo }) },
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../hooks/useCotizacionInicial', () => ({ useCotizacionInicial: mocks.useCotizacionInicial }))
vi.mock('../../hooks/useAlicuotas', () => ({ useAlicuotas: mocks.useAlicuotas }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoCreate } from './create'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const A21 = { id: 'a21', nombre: '21 %', porcentaje: 21, exento: false }
const A105 = { id: 'a105', nombre: '10,5 %', porcentaje: 10.5, exento: false }
const EXENTO = { id: 'ex', nombre: 'Exento', porcentaje: 0, exento: true }

const EMPRESAS = [
  { id: 'emp-1', nombre: 'San Javucho', activa: true },
  { id: 'emp-2', nombre: 'Mundo JC', activa: true },
]

const CATEGORIAS = [
  { id: 'cat-0', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] },
  { id: 'cat-1', nombre: 'Cableados', padre_id: 'cat-0', posicion: 0, empresa_ids: [] },
]

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/productos/create']}>
      <Routes>
        <Route path="/productos/create" element={<ProductoCreate />} />
        <Route path="/" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  )

const completar = () => {
  fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
  fireEvent.change(screen.getByLabelText(/^Precio de lista/), { target: { value: '49,90' } })
}

describe('ProductoCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCategorias.mockReturnValue({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() })
    niveles('edicion', 'ninguno')
    mocks.useCotizacionInicial.mockReturnValue({ cotizacion: null, cargando: false, hayError: false, recargar: vi.fn() })
    mocks.useAlicuotas.mockReturnValue({ alicuotas: [A21, A105, EXENTO], porId: new Map([[A21.id, A21], [A105.id, A105], [EXENTO.id, EXENTO]]), isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useProveedoresBasico.mockReturnValue({
      proveedores: [
        { id: 'prv-1', razon_social: 'Proveedor Uno SA', activo: true },
        { id: 'prv-2', razon_social: 'Proveedor Viejo SA', activo: false },
      ],
      cargando: false, hayError: false, recargar: vi.fn(),
    })
    mocks.rpc.mockResolvedValue({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
    mocks.subir.mockResolvedValue({ error: null })
    mocks.insertarImagen.mockResolvedValue({ error: null })
    mocks.quitarArchivo.mockResolvedValue({ error: null })
    mocks.leerImagenes.mockResolvedValue({ data: [], error: null })
  })

  it('sin datos obligatorios avisa, marca los campos y no guarda', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Faltan datos obligatorios')).toBeInTheDocument()
    expect(screen.getAllByText(/Ingresá el/).length).toBeGreaterThanOrEqual(2)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('guarda sin stock y confirma el éxito', async () => {
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'crear_producto',
        expect.objectContaining({ p_nombre: 'Joystick Pro', p_precio_lista: 49.9, p_moneda: 'USD', p_costo: null }),
      ),
    )
    expect(Object.keys(mocks.rpc.mock.calls[0][1]).some((clave) => clave.includes('stock'))).toBe(false)
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
  })

  it('el IVA propio se asigna después de crear; sin elegirlo no se llama a la RPC (F-PRE-12)', async () => {
    abrir()
    completar()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'IVA' }))
    fireEvent.click(screen.getByRole('option', { name: '10,5 %' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('asignar_alicuota_producto', { p_producto: 'p-9', p_alicuota: 'a105' })
  })

  it('los precios por escala se guardan después de crear; sin cargarlos no se llama a la RPC (F-PRE-15)', async () => {
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText(/^x5 · 5 a 9 u\./), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_precios_escala', { p_producto: 'p-9', p_x5: 40, p_x10: null, p_x50: null })
  })

  it('sin cargar escalas no llama a guardar_precios_escala', async () => {
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('guardar_precios_escala', expect.anything())
  })

  it('si fallan los precios por escala, el producto queda creado y se ofrece reintentar', async () => {
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(
        nombre === 'guardar_precios_escala'
          ? { data: null, error: { code: '42501', message: 'raw' } }
          : { data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null },
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText(/^x10 · 10 a 49 u\./), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText(/El producto se creó, pero no pudimos guardar los precios por escala/)).toBeInTheDocument()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar precios por escala' }))
    await waitFor(() =>
      expect(screen.queryByText(/El producto se creó, pero no pudimos guardar los precios por escala/)).not.toBeInTheDocument(),
    )
  })

  it('sin elegir IVA el producto hereda el de su categoría y no llama a la RPC de IVA', async () => {
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('asignar_alicuota_producto', expect.anything())
  })

  it('si falla asignar el IVA, el producto queda creado y se ofrece reintentar', async () => {
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(
        nombre === 'asignar_alicuota_producto'
          ? { data: null, error: { code: '42501', message: 'raw' } }
          : { data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null },
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'IVA' }))
    fireEvent.click(screen.getByRole('option', { name: 'Exento' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText(/El producto se creó, pero no pudimos asignarle el IVA/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar IVA' }))
    expect(await screen.findByText(/Tu rol no puede cambiar el IVA/)).toBeInTheDocument()
  })

  it('el proveedor es opcional: sin elegirlo viaja nulo', async () => {
    abrir()
    completar()
    expect(screen.getByLabelText('Código del proveedor')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('crear_producto', expect.objectContaining({ p_proveedor_id: null, p_codigo_proveedor: null })),
    )
  })

  it('elige un proveedor activo (no ofrece los inactivos) y manda su código', async () => {
    abrir()
    completar()
    fireEvent.mouseDown(screen.getByLabelText(/^Proveedor$/))
    expect(screen.queryByRole('option', { name: /Proveedor Viejo SA/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('option', { name: 'Proveedor Uno SA' }))
    fireEvent.change(screen.getByLabelText('Código del proveedor'), { target: { value: ' JOY-77 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'crear_producto',
        expect.objectContaining({ p_proveedor_id: 'prv-1', p_codigo_proveedor: 'JOY-77' }),
      ),
    )
  })

  it('manda el código de barras de 13 dígitos y marca el repetido en el campo', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "productos_org_codigo_barras_uidx"' },
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText('Código de barras (EAN-13)'), { target: { value: ' 7790001000015 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('crear_producto', expect.objectContaining({ p_codigo_barras: '7790001000015' })),
    )
    expect(await screen.findByText('Ese código de barras ya existe')).toBeInTheDocument()
  })

  it('sin proveedores activos avisa «No hay proveedores activos»', async () => {
    mocks.useProveedoresBasico.mockReturnValue({ proveedores: [], cargando: false, hayError: false, recargar: vi.fn() })
    abrir()
    fireEvent.mouseDown(screen.getByLabelText(/^Proveedor$/))
    expect(await screen.findByText('No hay proveedores activos')).toBeInTheDocument()
  })

  it('si falla la carga de proveedores lo dice y permite reintentar', () => {
    const recargar = vi.fn()
    mocks.useProveedoresBasico.mockReturnValue({ proveedores: [], cargando: false, hayError: true, recargar })
    abrir()
    expect(screen.getByText('No pudimos cargar los proveedores.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar proveedores' }))
    expect(recargar).toHaveBeenCalled()
  })

  it('no ofrece stock inicial y sin cotización pide cargarla en lugar de inventar un precio en pesos', () => {
    abrir()
    expect(screen.queryByLabelText(/stock/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('—')
    expect(screen.getByText('Cargá la cotización')).toBeInTheDocument()
  })

  it('el Operador no ve el campo Costo', () => {
    abrir()
    expect(screen.queryByLabelText('Costo')).not.toBeInTheDocument()
  })

  it('con edición en Rentabilidad se ve el costo y viaja', async () => {
    niveles('edicion', 'edicion')
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText('Costo'), { target: { value: '1500,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('crear_producto', expect.objectContaining({ p_costo: 1500.5 })))
  })

  it('un error del servidor conserva lo cargado y no filtra el detalle técnico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('No se guardó el producto.')).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
  })

  it('SKU repetido: muestra «Ese SKU ya existe» y conserva lo cargado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "productos_org_sku_uidx"' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: 'ABC-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Ese SKU ya existe')).toBeInTheDocument()
    expect(screen.getByLabelText(/^SKU/)).toBeInvalid()
    expect(screen.getByLabelText(/^SKU/)).toHaveAccessibleDescription('Ese SKU ya existe')
    expect(screen.queryByText(/productos_org_sku_uidx/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
    expect(screen.getByLabelText(/^SKU/)).toHaveValue('ABC-1')
  })

  it('el campo SKU explica que se genera solo si queda vacío', () => {
    abrir()
    expect(screen.getByText('Se genera solo si lo dejás vacío')).toBeInTheDocument()
  })

  it('Cancelar con datos pide confirmar «Descartar cambios»; sin datos sale directo', () => {
    const primera = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    primera.unmount()

    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: 'Descartar cambios' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
  })

  it('con solo lectura en Productos no ofrece el formulario', () => {
    niveles('lectura', 'ninguno')
    abrir()
    expect(screen.getByText('Tu rol no puede crear productos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear producto' })).not.toBeInTheDocument()
  })

  const elegir = (...archivos: File[]) =>
    fireEvent.change(screen.getByTestId('entrada-imagenes'), { target: { files: archivos } })
  const png = (nombre: string) => new File(['x'], nombre, { type: 'image/png' })

  it('sube las imágenes elegidas al crear, con la ruta de su organización y producto', async () => {
    abrir()
    completar()
    elegir(png('frente.png'), png('lado.png'))
    expect(screen.getByRole('img', { name: 'Imagen 1 (principal), se sube al guardar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.subir).toHaveBeenCalledTimes(2)
    expect(mocks.subir.mock.calls[0][0]).toMatch(/^org-1\/p-9\/[0-9a-f-]+\.png$/)
    expect(mocks.insertarImagen).toHaveBeenNthCalledWith(1, expect.objectContaining({ producto_id: 'p-9', organizacion_id: 'org-1', posicion: 1 }))
    expect(mocks.insertarImagen).toHaveBeenNthCalledWith(2, expect.objectContaining({ posicion: 2 }))
  })

  it('si una imagen falla, el producto igual queda creado y se ofrece reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.subir.mockResolvedValueOnce({ error: { message: 'boom' } })
    abrir()
    completar()
    elegir(png('frente.png'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(screen.getByText(/hubo problemas con las imágenes/)).toBeInTheDocument()
    expect(screen.getByText('No pudimos subir «frente.png».')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))
    await waitFor(() => expect(screen.queryByText(/hubo problemas con las imágenes/)).not.toBeInTheDocument())
    expect(mocks.insertarImagen).toHaveBeenCalledTimes(1)
  })

  it('si la fila no se registra, borra el archivo recién subido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.insertarImagen.mockResolvedValueOnce({ error: { code: '42501', message: 'rls' } })
    abrir()
    completar()
    elegir(png('frente.png'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Tu rol no puede modificar las imágenes de este producto.')).toBeInTheDocument()
    expect(mocks.quitarArchivo).toHaveBeenCalledWith([mocks.subir.mock.calls[0][0]])
  })

  it('el reintento respeta las posiciones ya ocupadas: sube solo la que falló en la 2.ª', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.subir.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } })
    abrir()
    completar()
    elegir(png('frente.png'), png('lado.png'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('No pudimos subir «lado.png».')).toBeInTheDocument()
    expect(mocks.insertarImagen).toHaveBeenCalledTimes(1)
    mocks.leerImagenes.mockResolvedValue({ data: [{ id: 'i-1', posicion: 1, ruta: 'org-1/p-9/a.png' }], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar subida' }))
    await waitFor(() => expect(screen.queryByText(/hubo problemas con las imágenes/)).not.toBeInTheDocument())
    expect(mocks.insertarImagen).toHaveBeenCalledTimes(2)
    expect(mocks.insertarImagen).toHaveBeenLastCalledWith(expect.objectContaining({ posicion: 2 }))
  })

  it('una excepción al subir no se muestra como «no se guardó» y ofrece reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.subir.mockRejectedValueOnce(new Error('red caída'))
    abrir()
    completar()
    elegir(png('frente.png'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(screen.getByText('No pudimos subir «frente.png».')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar subida' })).toBeInTheDocument()
  })

  it('muestra «Empresas que lo venden» con una fila por empresa, sin ninguna marcada, y la nota de visibilidad', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Empresas que lo venden' })).toBeInTheDocument()
    expect(screen.getByText('El producto y su stock son únicos y compartidos. Cada tienda lo publica con su propio precio y estado.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'San Javucho' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Mundo JC' })).not.toBeChecked()
    expect(screen.getAllByText('Precio: —')).toHaveLength(2)
    expect(screen.getByText('No se muestra en ninguna store: el producto no aparece en el catálogo público.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'San Javucho' }))
    expect(screen.getByText('Visible en San Javucho.')).toBeInTheDocument()
  })

  it('tras crear, guarda las empresas elegidas con la RPC', async () => {
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(nombre === 'crear_producto' ? { data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null } : { data: 1, error: null }))
    abrir()
    completar()
    fireEvent.click(screen.getByRole('switch', { name: 'Mundo JC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('definir_empresas_producto', { p_producto_id: 'p-9', p_empresa_ids: ['emp-2'] })
  })

  it('sin empresas elegidas no llama a la RPC de empresas', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('definir_empresas_producto', expect.anything())
  })

  it('si fallan las empresas, el producto queda creado y se reintenta con lo elegido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fallar = true
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'crear_producto') return Promise.resolve({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
      if (fallar) return Promise.resolve({ data: null, error: { code: '57014', message: 'boom interno' } })
      return Promise.resolve({ data: 1, error: null })
    })
    abrir()
    completar()
    fireEvent.click(screen.getByRole('switch', { name: 'San Javucho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(screen.getByText(/no pudimos guardar las empresas que lo venden/)).toBeInTheDocument()
    expect(screen.queryByText(/boom interno/)).not.toBeInTheDocument()
    fallar = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar empresas' }))
    await waitFor(() => expect(screen.queryByText(/no pudimos guardar las empresas que lo venden/)).not.toBeInTheDocument())
    expect(mocks.rpc).toHaveBeenLastCalledWith('definir_empresas_producto', { p_producto_id: 'p-9', p_empresa_ids: ['emp-1'] })
  })

  it('ofrece la categoría opcional con su ruta de 2 niveles y, tras crear, la asigna con la RPC (F-CAT-08)', async () => {
    mocks.useCategorias.mockReturnValue({ categorias: CATEGORIAS, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(nombre === 'crear_producto' ? { data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null } : { data: null, error: null }))
    abrir()
    completar()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    expect(screen.getByRole('option', { name: 'Sin categoría' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Joysticks' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Joysticks > Cableados' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('asignar_categoria_producto', { p_producto_id: 'p-9', p_categoria_id: 'cat-1' })
  })

  it('sin categoría elegida no llama a la RPC de categoría', async () => {
    mocks.useCategorias.mockReturnValue({ categorias: CATEGORIAS, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.rpc.mockResolvedValue({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('asignar_categoria_producto', expect.anything())
  })

  it('si falla la categoría, el producto queda creado y se reintenta con lo elegido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useCategorias.mockReturnValue({ categorias: CATEGORIAS, isLoading: false, isError: false, refetch: vi.fn() })
    let fallar = true
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'crear_producto') return Promise.resolve({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
      return Promise.resolve(fallar ? { data: null, error: { code: '57014', message: 'boom interno' } } : { data: null, error: null })
    })
    abrir()
    completar()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    fireEvent.click(screen.getByRole('option', { name: 'Joysticks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
    expect(screen.getByText(/no pudimos asignarle la categoría/)).toBeInTheDocument()
    expect(screen.queryByText(/boom interno/)).not.toBeInTheDocument()
    fallar = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar categoría' }))
    await waitFor(() => expect(screen.queryByText(/no pudimos asignarle la categoría/)).not.toBeInTheDocument())
    expect(mocks.rpc).toHaveBeenLastCalledWith('asignar_categoria_producto', { p_producto_id: 'p-9', p_categoria_id: 'cat-0' })
  })
})
