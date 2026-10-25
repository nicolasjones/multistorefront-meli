import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoEdit } from './edit'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const PRODUCTO = {
  id: 'p-1', organizacion_id: 'org-1', nombre: 'Joystick', descripcion: null, sku: 'JOY-1', compatible_con: ['PS5'],
  moneda: 'USD', precio_lista: 49.9, activo: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
  proveedor_id: 'prv-2', codigo_proveedor: 'VIEJO-1',
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion', 'edicion')
    mocks.producto.mockResolvedValue({ data: PRODUCTO, error: null })
    mocks.useProveedoresBasico.mockReturnValue({
      proveedores: [
        { id: 'prv-1', razon_social: 'Proveedor Uno SA', activo: true },
        { id: 'prv-2', razon_social: 'Proveedor Viejo SA', activo: false },
      ],
      cargando: false, hayError: false, recargar: vi.fn(),
    })
    mocks.costo.mockResolvedValue({ data: { costo: 20 }, error: null })
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
    expect(screen.getByLabelText('Código del proveedor')).toHaveValue('VIEJO-1')
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({ p_proveedor_id: 'prv-2', p_codigo_proveedor: 'VIEJO-1' }),
      ),
    )
  })

  it('quitar el proveedor borra el código y viaja nulo', async () => {
    abrir()
    const selector = await screen.findByLabelText(/^Proveedor$/)
    fireEvent.change(selector, { target: { value: '' } })
    expect(selector).toHaveValue('')
    expect(screen.getByLabelText('Código del proveedor')).toHaveValue('')
    expect(screen.getByLabelText('Código del proveedor')).toBeDisabled()
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
})
