import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import type { CatalogoTienda } from '../../../lib/tiendaCatalogo'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  guardar: vi.fn(),
  setWarnWhen: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useWarnAboutChange: () => ({ warnWhen: false, setWarnWhen: mocks.setWarnWhen }),
}))
vi.mock('../../../lib/tiendaCatalogo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaCatalogo')>()),
  listarCatalogoTienda: mocks.listar,
  guardarCatalogoTienda: mocks.guardar,
}))

import PestanaCatalogo from './pestanas/catalogo'

// F-TDA-04 (SC-014): pestaña «Catálogo visible». Vive fuera de `pestanas/` porque esa carpeta se
// carga con import.meta.glob y el build empaquetaría el test.

const producto = (id: string, nombre: string, extra: Partial<CatalogoTienda['productos'][number]> = {}) => ({
  id, nombre, moneda: 'USD', precio: 10 as number | null, stock: 3, visible: true, destacado: false, efectivo: true, motivo: null, ...extra,
})

const catalogoDeA: CatalogoTienda = {
  categorias: [
    { id: 'c-1', nombre: 'Consolas', padreId: null, visible: true, productos: 2 },
    { id: 'c-2', nombre: 'Portátiles', padreId: 'c-1', visible: true, productos: 1 },
  ],
  productos: [
    producto('p-1', 'Joystick', { precio: 49.9, stock: 7 }),
    producto('p-2', 'Cable'),
    producto('p-3', 'Teclado viejo', { efectivo: false, motivo: 'No se muestra: producto inactivo' }),
    producto('p-4', 'Sin precio', { precio: null }),
  ],
  resumen: { visibles: 3, destacados: 0 },
}

const catalogoDeB: CatalogoTienda = {
  categorias: [],
  productos: [producto('p-9', 'Producto de B')],
  resumen: { visibles: 1, destacados: 0 },
}

async function abrir(empresaId = 'e-1', empresaNombre = 'Mundo JC') {
  const vista = render(<PestanaCatalogo empresaId={empresaId} empresaNombre={empresaNombre} />)
  await screen.findByRole('heading', { name: 'Productos visibles y destacados' })
  return vista
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listar.mockImplementation(async (id: string) => (id === 'e-2' ? catalogoDeB : catalogoDeA))
  mocks.guardar.mockResolvedValue({ visibles: 3, destacados: 1 })
})

describe('Catálogo visible · textos y columnas (FR-041, FR-042, FR-047)', () => {
  it('muestra las dos secciones con su texto de ayuda y el buscador', async () => {
    await abrir()
    expect(screen.getByRole('heading', { name: 'Categorías visibles' })).toBeInTheDocument()
    expect(screen.getByText('Las categorías ocultas no aparecen en el menú ni en los filtros de esta store.')).toBeInTheDocument()
    expect(screen.getByText('Un producto inactivo o sin la categoría visible no se muestra aunque esté marcado.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Buscar producto' })).toBeInTheDocument()
  })

  it('lista las categorías con su conteo «· N productos»', async () => {
    await abrir()
    expect(screen.getByText('· 2 productos')).toBeInTheDocument()
    expect(screen.getByText('· 1 producto')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Mostrar la categoría Consolas/ })).toBeChecked()
  })

  it('la tabla tiene las columnas Producto, Precio, Stock, Visible y Destacado', async () => {
    await abrir()
    const tabla = screen.getByRole('table')
    for (const columna of ['Producto', 'Precio', 'Stock', 'Visible', 'Destacado']) {
      expect(within(tabla).getByRole('columnheader', { name: columna })).toBeInTheDocument()
    }
  })

  it('precio y stock son de lectura y sin precio muestra «—»', async () => {
    await abrir()
    const fila = screen.getByText('Joystick').closest('tr') as HTMLElement
    expect(within(fila).getByText('USD 49,90')).toBeInTheDocument()
    expect(within(fila).getByText('7')).toBeInTheDocument()
    expect(within(fila).queryByRole('spinbutton')).toBeNull()
    const sinPrecio = screen.getByText('Sin precio').closest('tr') as HTMLElement
    expect(within(sinPrecio).getByText('—')).toBeInTheDocument()
  })
})

describe('Catálogo visible · visibilidad efectiva y resumen (FR-044, FR-045)', () => {
  it('la fila no efectiva muestra el motivo calculado en el servidor y el resto no', async () => {
    await abrir()
    expect(screen.getByText('No se muestra: producto inactivo')).toBeInTheDocument()
    const fila = screen.getByText('Joystick').closest('tr') as HTMLElement
    expect(within(fila).queryByText(/No se muestra/)).toBeNull()
  })

  it('muestra el resumen «N visibles, M destacados» que devuelve la base', async () => {
    await abrir()
    expect(screen.getByText('3 visibles, 0 destacados')).toBeInTheDocument()
  })
})

describe('Catálogo visible · buscador (FR-042)', () => {
  it('filtra la tabla por nombre sin distinguir mayúsculas', async () => {
    await abrir()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar producto' }), { target: { value: 'joy' } })
    expect(screen.getByText('Joystick')).toBeInTheDocument()
    expect(screen.queryByText('Cable')).toBeNull()
  })

  it('avisa cuando ningún producto coincide', async () => {
    await abrir()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar producto' }), { target: { value: 'zzz' } })
    expect(screen.getByText('Ningún producto coincide con la búsqueda.')).toBeInTheDocument()
  })
})

describe('Catálogo visible · destacar (FR-046)', () => {
  it('destacar un producto visible marca la estrella sin pedir confirmación', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Joystick' }))
    expect(screen.queryByText('Este producto no se muestra en la tienda. ¿Destacarlo igual?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Quitar destacado de Joystick' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('destacar un producto que no se muestra pide confirmación antes de marcarlo', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Teclado viejo' }))
    expect(screen.getByText('Este producto no se muestra en la tienda. ¿Destacarlo igual?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Destacar Teclado viejo', hidden: true })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Destacar igual' }))
    expect(await screen.findByRole('button', { name: 'Quitar destacado de Teclado viejo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cancelar la confirmación no cambia nada', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Teclado viejo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByText('Este producto no se muestra en la tienda. ¿Destacarlo igual?')).toBeNull())
    expect(screen.getByRole('button', { name: 'Destacar Teclado viejo' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Hay cambios sin guardar')).toBeNull()
  })

  it('un producto ocultado por el borrador también pide confirmación', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Cable' }))
    expect(screen.getByText('Este producto no se muestra en la tienda. ¿Destacarlo igual?')).toBeInTheDocument()
  })
})

describe('Catálogo visible · Guardar y Descartar (FR-048)', () => {
  it('Guardar manda solo lo que cambió y recarga lo guardado', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: /Mostrar la categoría Portátiles/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Joystick' }))
    expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith('e-1', {
      categorias: [{ id: 'c-2', visible: false }],
      productos: [{ id: 'p-1', visible: true, destacado: true }],
    })
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Hay cambios sin guardar')).toBeNull())
  })

  it('Descartar restaura lo guardado y no escribe', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    expect(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' })).toBeChecked()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('volver el interruptor a su valor guardado ya no cuenta como cambio', async () => {
    await abrir()
    const interruptor = screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' })
    fireEvent.click(interruptor)
    fireEvent.click(interruptor)
    expect(screen.queryByText('Hay cambios sin guardar')).toBeNull()
  })

  it('avisa a la gestión de los cambios sin guardar (Principio VIII)', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    await waitFor(() => expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(true))
  })

  it('si falla el guardado muestra el error y conserva el borrador', async () => {
    mocks.guardar.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/No pudimos guardar los cambios/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' })).not.toBeChecked()
  })

  it('si falla la recarga tras guardar no pisa el catálogo ni ofrece «Reintentar»', async () => {
    await abrir()
    mocks.listar.mockRejectedValueOnce(new Error('boom'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledTimes(2))
    // El `catch` de la recarga ya corrió (registra el error): recién ahí se afirma la ausencia.
    await waitFor(() => expect(error).toHaveBeenCalledWith('No se pudo cargar el catálogo de la tienda', 'boom'))
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
  })
})

describe('Catálogo visible · empresa activa (Principio VIII)', () => {
  it('al cambiar de empresa recarga, descarta el borrador y no muestra datos de la anterior', async () => {
    const { rerender } = await abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Cable en la tienda' }))
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Teclado viejo' }))

    rerender(<PestanaCatalogo empresaId="e-2" empresaNombre="San Javucho" />)

    expect(await screen.findByText('Producto de B')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenLastCalledWith('e-2')
    expect(screen.queryByText('Joystick')).toBeNull()
    expect(screen.queryByText('Hay cambios sin guardar')).toBeNull()
    expect(screen.queryByText('Este producto no se muestra en la tienda. ¿Destacarlo igual?')).toBeNull()
    expect(screen.getByText('1 visible, 0 destacados')).toBeInTheDocument()
  })

  it('cambiar de empresa mientras se guarda no deja «Guardar» ni «Descartar» bloqueados', async () => {
    let terminar: (v: { visibles: number; destacados: number }) => void = () => {}
    mocks.guardar.mockReturnValueOnce(new Promise((resolver) => { terminar = resolver }))
    const { rerender } = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Joystick' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))

    rerender(<PestanaCatalogo empresaId="e-2" empresaNombre="San Javucho" />)
    expect(await screen.findByText('Producto de B')).toBeInTheDocument()
    terminar({ visibles: 3, destacados: 1 })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar Producto de B en la tienda' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeEnabled()
  })
})

describe('Catálogo visible · estados', () => {
  it('muestra la carga y luego el contenido', async () => {
    render(<PestanaCatalogo empresaId="e-1" empresaNombre="Mundo JC" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Categorías visibles' })
  })

  it('muestra el error con «Reintentar» si no carga', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listar.mockRejectedValueOnce(new Error('boom'))
    render(<PestanaCatalogo empresaId="e-1" empresaNombre="Mundo JC" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    await screen.findByRole('heading', { name: 'Categorías visibles' })
  })

  it('muestra el vacío cuando la tienda no tiene productos', async () => {
    mocks.listar.mockResolvedValueOnce({ categorias: [], productos: [], resumen: { visibles: 0, destacados: 0 } })
    render(<PestanaCatalogo empresaId="e-1" empresaNombre="Mundo JC" />)
    expect(await screen.findByText('Esta tienda todavía no tiene productos.')).toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
  it('la pestaña no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    const { container } = await abrir()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
