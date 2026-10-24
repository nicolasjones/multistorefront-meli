import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  productos: vi.fn(),
  motivos: vi.fn(),
  eq: vi.fn(),
  tablas: [] as string[],
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: (tabla: string) => {
        mocks.tablas.push(tabla)
        const cadena = {
          select: () => cadena,
          eq: (...argumentos: unknown[]) => { mocks.eq(...argumentos); return cadena },
          order: () => cadena,
          limit: () => cadena,
          returns: tabla === 'productos' ? mocks.productos : mocks.motivos,
        }
        return cadena
      },
    }),
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { LoteStock } from './lote'

const PRODUCTOS = [1, 2, 3, 4, 5].map((n) => ({ id: `p-${n}`, nombre: `Producto ${n}`, sku: `P-${n}` }))
const MOTIVOS = [
  { id: 'm-compra', nombre: 'Compra a proveedor', aplica_a: ['entrada'] },
  { id: 'm-venta', nombre: 'Venta en local', aplica_a: ['salida'] },
]
const LOTES = [
  { id: 'l-2', numero: 2, fecha: '2026-10-20', proveedor: null, productos: 1, unidades: 4, creado_en: '2026-10-20T10:00:00Z' },
  { id: 'l-1', numero: 1, fecha: '2026-10-18', proveedor: 'Distribuidora Sur', productos: 5, unidades: 15, creado_en: '2026-10-18T10:00:00Z' },
]

const abrir = () => render(<MemoryRouter><LoteStock /></MemoryRouter>)

async function elegirProducto(indice: number, nombre: string) {
  const caja = await screen.findByLabelText(`Producto ${indice}`)
  fireEvent.mouseDown(caja)
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(nombre) }))
}

const poner = (etiqueta: string, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

async function cargarCincoLineas() {
  await screen.findByRole('button', { name: 'Confirmar' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
  for (let n = 2; n <= 5; n += 1) fireEvent.click(screen.getByRole('button', { name: 'Agregar producto' }))
  for (let n = 1; n <= 5; n += 1) {
    await elegirProducto(n, `Producto ${n}`)
    poner(`Cantidad ${n}`, String(n))
  }
}

const llamadasRegistrar = () => mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_lote_stock')

describe('LoteStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tablas.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.productos.mockResolvedValue({ data: PRODUCTOS, error: null })
    mocks.motivos.mockResolvedValue({ data: MOTIVOS, error: null })
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'listar_lotes_stock') return { data: LOTES, error: null }
      if (nombre === 'listar_movimientos_lote') {
        return { data: [{ movimiento_id: 'mov-1', producto: 'Producto 1', sku: 'P-1', cantidad: 1, saldo: 1, creado_en: '2026-10-18T10:00:00Z' }], error: null }
      }
      return { data: { lote: { id: 'l-3', numero: 3, proveedor: 'Distribuidora Sur', fecha: '2026-10-24', motivo_id: 'm-compra' }, movimientos: [] }, error: null }
    })
  })

  it('carga un lote de 5 productos y muestra el número de lote', async () => {
    abrir()
    await cargarCincoLineas()
    poner('Proveedor', '  Distribuidora Sur ')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Lote 3 registrado')).toBeInTheDocument()
    expect(llamadasRegistrar()).toHaveLength(1)
    const [, argumentos] = llamadasRegistrar()[0]
    expect(argumentos.p_lineas).toEqual([1, 2, 3, 4, 5].map((n) => ({ producto: `p-${n}`, cantidad: n })))
    expect(argumentos.p_proveedor).toBe('Distribuidora Sur')
    expect(argumentos.p_motivo).toBe('m-compra')
    expect(typeof argumentos.p_clave).toBe('string')
  }, 30_000)

  it('solo ofrece motivos aplicables a entradas', async () => {
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Motivo' }))
    const lista = await screen.findByRole('listbox')
    expect(within(lista).getByText('Compra a proveedor')).toBeInTheDocument()
    expect(within(lista).queryByText('Venta en local')).not.toBeInTheDocument()
  })

  it('rechaza cantidad 0, negativa y producto repetido sin enviar nada', async () => {
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Agregar producto' }))
    await elegirProducto(1, 'Producto 1')
    await elegirProducto(2, 'Producto 1')
    poner('Cantidad 1', '0')
    poner('Cantidad 2', '-3')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Este producto ya está en el lote.')).toBeInTheDocument()
    expect(screen.getAllByText('Ingresá un entero mayor a cero.')).toHaveLength(2)
    expect(llamadasRegistrar()).toHaveLength(0)
  })

  it('no deja confirmar sin líneas', async () => {
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el producto 1' }))
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(llamadasRegistrar()).toHaveLength(0)
  })

  it('ante un error del servidor avisa y permite reintentar con la misma clave', async () => {
    let intento = 0
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'listar_lotes_stock') return { data: [], error: null }
      intento += 1
      if (intento === 1) return { data: null, error: { code: '22023', message: 'Uno de los productos no existe, está inactivo o es de otra organización' } }
      return { data: { lote: { id: 'l-1', numero: 1, proveedor: null, fecha: '2026-10-24', motivo_id: 'm-compra' }, movimientos: [] }, error: null }
    })
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    await elegirProducto(1, 'Producto 1')
    poner('Cantidad 1', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Uno de los productos no existe, está inactivo o es de otra organización')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Lote 1 registrado')).toBeInTheDocument()
    const llamadas = llamadasRegistrar()
    expect(llamadas).toHaveLength(2)
    expect(llamadas[1][1].p_clave).toBe(llamadas[0][1].p_clave)
  })

  it('si la persona edita las líneas tras un error, el reintento usa una clave nueva', async () => {
    let intento = 0
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'listar_lotes_stock') return { data: [], error: null }
      intento += 1
      if (intento === 1) return { data: null, error: { message: 'red caída' } }
      return { data: { lote: { id: 'l-1', numero: 1, proveedor: null, fecha: '2026-10-24', motivo_id: 'm-compra' }, movimientos: [] }, error: null }
    })
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    await elegirProducto(1, 'Producto 1')
    poner('Cantidad 1', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByText('No pudimos registrar el lote. Intentá de nuevo.')
    poner('Cantidad 1', '7')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Lote 1 registrado')).toBeInTheDocument()
    const llamadas = llamadasRegistrar()
    expect(llamadas[1][1].p_clave).not.toBe(llamadas[0][1].p_clave)
    expect(llamadas[1][1].p_lineas).toEqual([{ producto: 'p-1', cantidad: 7 }])
  })

  it('avisa cuando el catálogo de productos se cortó en el máximo', async () => {
    mocks.productos.mockResolvedValue({
      data: Array.from({ length: 500 }, (_, n) => ({ id: `x-${n}`, nombre: `Prod ${n}`, sku: null })),
      error: null,
    })
    abrir()
    expect(await screen.findByText(/Se muestran los primeros 500 productos activos/)).toBeInTheDocument()
  })

  it('un doble clic en Confirmar envía una sola vez', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'listar_lotes_stock') return Promise.resolve({ data: [], error: null })
      return new Promise((resolve) => { resolver = resolve })
    })
    abrir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).not.toBeDisabled())
    await elegirProducto(1, 'Producto 1')
    poner('Cantidad 1', '2')
    const boton = screen.getByRole('button', { name: 'Confirmar' })
    fireEvent.click(boton)
    fireEvent.click(boton)

    await waitFor(() => expect(llamadasRegistrar()).toHaveLength(1))
    resolver({ data: { lote: { id: 'l-1', numero: 1, proveedor: null, fecha: '2026-10-24', motivo_id: 'm-compra' }, movimientos: [] }, error: null })
    expect(await screen.findByText('Lote 1 registrado')).toBeInTheDocument()
    expect(llamadasRegistrar()).toHaveLength(1)
  })

  it('con rol de lectura no hay formulario pero sí historial', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(await screen.findByText('Tu rol puede ver el historial, pero no registrar lotes de stock.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
    expect(await screen.findByText('Lote 2')).toBeInTheDocument()
  })

  it('muestra el historial y abre el detalle de movimientos del lote', async () => {
    abrir()
    expect(await screen.findByText('Lote 1')).toBeInTheDocument()
    expect(screen.getByText('Distribuidora Sur')).toBeInTheDocument()
    expect(screen.getByText('18/10/2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el lote 1' }))

    const detalle = await screen.findByRole('dialog')
    expect(await within(detalle).findByText('Producto 1 · P-1')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('listar_movimientos_lote', { p_lote: 'l-1' })
  })

  it('muestra el estado vacío y el error con reintento del historial', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: [], error: null }))
    const { unmount } = abrir()
    expect(await screen.findByText('Todavía no hay lotes registrados.')).toBeInTheDocument()
    unmount()

    mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: 'boom' } }))
    abrir()
    expect(await screen.findByText('No pudimos cargar el historial de lotes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('no consulta por empresa: el stock es único por organización', async () => {
    abrir()
    await screen.findByText('Lote 1')
    expect([...mocks.tablas].sort()).toEqual(['motivos_movimiento', 'productos'])
    expect(mocks.eq.mock.calls.every(([columna]) => columna === 'activo')).toBe(true)
    for (const [, argumentos] of mocks.rpc.mock.calls) {
      expect(Object.keys(argumentos ?? {}).some((clave) => clave.includes('empresa'))).toBe(false)
    }
  })
})
