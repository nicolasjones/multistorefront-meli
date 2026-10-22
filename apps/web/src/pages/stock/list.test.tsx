import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consulta: vi.fn(),
  contar: vi.fn(),
  llamadas: [] as Array<[string, ...unknown[]]>,
  useNivelSeccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  alCambiarEnVivo: null as null | (() => void),
}))

// El hook de Realtime se prueba aparte; acá se captura el aviso para simular un cambio en vivo.
vi.mock('../../lib/useExistenciasRealtime', () => ({
  useExistenciasRealtime: (alCambiar: () => void) => { mocks.alCambiarEnVivo = alCambiar },
}))

// Constructor de consultas mínimo: registra cada filtro y resuelve en `returns` (listado) o
// en `eq` de la consulta con `head` (conteos del resumen).
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    from: (tabla: string) => {
      const registrar = (nombre: string) => (...args: unknown[]) => {
        mocks.llamadas.push([nombre, ...args])
        return constructor
      }
      const constructor = {
        select: (_columnas: string, opciones?: { head?: boolean }) =>
          opciones?.head
            ? { eq: (_campo: string, estado: string) => mocks.contar(tabla, estado) }
            : constructor,
        in: registrar('in'),
        eq: registrar('eq'),
        or: registrar('or'),
        order: registrar('order'),
        range: registrar('range'),
        returns: mocks.consulta,
      }
      return constructor
    },
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('./NuevoMovimientoDialog', () => ({
  default: (props: { productoId?: string; onCerrar: () => void; onRegistrado: () => void }) => (
    <div role="dialog" aria-label="Registrar movimiento de stock">
      <span>producto:{props.productoId || 'ninguno'}</span>
      <button type="button" onClick={props.onRegistrado}>simular registrado</button>
      <button type="button" onClick={props.onCerrar}>simular cierre</button>
    </div>
  ),
}))
vi.mock('./EditarMinimoDialog', () => ({
  default: (props: { producto: { id: string; minimo: number }; onCerrar: () => void; onGuardado: () => void }) => (
    <div role="dialog" aria-label="Stock mínimo">
      <span>minimo:{props.producto.id}:{props.producto.minimo}</span>
      <button type="button" onClick={props.onGuardado}>simular guardado</button>
    </div>
  ),
}))

import { StockList } from './list'

const FILAS = [
  { producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', cantidad: 6, minimo: 5, estado: 'disponible', ultimo_movimiento_en: '2026-10-10T12:00:00Z' },
  { producto_id: 'p-2', nombre: 'Cable', sku: null, cantidad: 0, minimo: 3, estado: 'sin_stock', ultimo_movimiento_en: null },
  { producto_id: 'p-3', nombre: 'Mouse', sku: 'MOU-1', cantidad: 2, minimo: 2, estado: 'stock_bajo', ultimo_movimiento_en: '2026-10-11T12:00:00Z' },
]

const abrir = () => render(<MemoryRouter><StockList /></MemoryRouter>)

const llamadasDe = (nombre: string) => mocks.llamadas.filter(([n]) => n === nombre).map(([, ...args]) => args)

describe('StockList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.llamadas.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 3 })
    mocks.contar.mockImplementation((_tabla: string, estado: string) =>
      Promise.resolve({ count: estado === 'sin_stock' ? 1 : 1, error: null }))
  })

  it('muestra producto, SKU, stock, mínimo, estado y último movimiento', async () => {
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('JOY-1')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    // Las etiquetas también existen como botones del filtro: la de la fila es un chip.
    const chips = Array.from(document.querySelectorAll('.MuiChip-label')).map((c) => c.textContent)
    expect(chips).toEqual(expect.arrayContaining(['Disponible', 'Sin stock', 'Stock bajo']))
    expect(screen.getByText('Sin movimientos')).toBeInTheDocument()
    expect(screen.getByText('3 productos')).toBeInTheDocument()
  })

  it('el resumen cuenta productos sin stock y con stock bajo, y «Ver solo alertas» filtra', async () => {
    mocks.contar.mockImplementation((_t: string, estado: string) =>
      Promise.resolve({ count: estado === 'sin_stock' ? 1 : 4, error: null }))
    abrir()
    expect(await screen.findByText('1 producto sin stock y 4 con stock bajo.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver solo alertas' }))
    await waitFor(() => expect(llamadasDe('in')).toContainEqual(['estado', ['sin_stock', 'stock_bajo']]))
    expect(await screen.findByRole('button', { name: 'Ver todos' })).toBeInTheDocument()
  })

  it('sin alertas no muestra el resumen', async () => {
    mocks.contar.mockResolvedValue({ count: 0, error: null })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: 'Ver solo alertas' })).not.toBeInTheDocument()
  })

  it('si falla el resumen el listado sigue visible', async () => {
    mocks.contar.mockResolvedValue({ count: null, error: { code: 'XX000', message: 'boom' } })
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver solo alertas' })).not.toBeInTheDocument()
  })

  it('filtra por estado desde los botones', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Stock bajo' }))
    await waitFor(() => expect(llamadasDe('eq')).toContainEqual(['estado', 'stock_bajo']))
  })

  it('busca por nombre o SKU escapando comodines y separadores', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.change(screen.getByLabelText('Buscar por nombre o SKU'), { target: { value: 'JOY_1,(x)' } })
    await waitFor(() => expect(llamadasDe('or')).toContainEqual(['nombre.ilike.%JOY\\_1  x%,sku.ilike.%JOY\\_1  x%']))
  })

  it('una búsqueda sin resultados avisa y no confunde con el catálogo vacío', async () => {
    abrir()
    await screen.findByText('Joystick')
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    fireEvent.change(screen.getByLabelText('Buscar por nombre o SKU'), { target: { value: 'zzz' } })
    expect(await screen.findByText('Ningún producto coincide con la búsqueda o el filtro.')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay productos para llevar stock.')).not.toBeInTheDocument()
  })

  it('con edición ofrece «Nuevo movimiento» general y por fila, y abre el diálogo con el producto', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento' }))
    expect(await screen.findByText('producto:ninguno')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'simular cierre' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento de Cable' }))
    expect(await screen.findByText('producto:p-2')).toBeInTheDocument()
  })

  it('con edición permite editar el mínimo de una fila y recarga al guardar', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Editar mínimo de Mouse' }))
    expect(await screen.findByText('minimo:p-3:2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'simular guardado' }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('al registrar un movimiento recarga el listado', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento' }))
    fireEvent.click(await screen.findByRole('button', { name: 'simular registrado' }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('un aviso en vivo recarga listado y resumen conservando búsqueda y filtro, sin vaciar la tabla', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Stock bajo' }))
    fireEvent.change(screen.getByLabelText('Buscar por nombre o SKU'), { target: { value: 'mou' } })
    await waitFor(() => expect(llamadasDe('or')).toContainEqual(['nombre.ilike.%mou%,sku.ilike.%mou%']))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(3))
    const campo = screen.getByLabelText('Buscar por nombre o SKU')
    campo.focus()
    mocks.llamadas.length = 0
    mocks.contar.mockClear()
    mocks.consulta.mockClear()

    mocks.alCambiarEnVivo?.()

    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(1))
    expect(mocks.contar).toHaveBeenCalledTimes(2)
    expect(llamadasDe('eq')).toContainEqual(['estado', 'stock_bajo'])
    expect(llamadasDe('or')).toContainEqual(['nombre.ilike.%mou%,sku.ilike.%mou%'])
    expect(screen.getByText('Joystick')).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar por nombre o SKU')).toBe(campo)
    expect(campo).toHaveFocus()
  })

  it('con solo lectura (Consulta) ve todo sin botones de movimiento ni de mínimo', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /Nuevo movimiento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar mínimo/ })).not.toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('Stock bajo', { selector: '.MuiChip-label' })).toBeInTheDocument()
  })

  it('el acceso a Motivos aparece solo para quien puede administrarlos', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('link', { name: 'Motivos de movimiento' })).not.toBeInTheDocument()
  })

  it('el Administrador ve el enlace a /stock/motivos', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Motivos de movimiento' })).toHaveAttribute('href', '/stock/motivos')
  })

  it('sin productos muestra el estado vacío', async () => {
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay productos para llevar stock.')).toBeInTheDocument()
  })

  it('un error de carga se avisa en castellano y permite reintentar', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar el stock.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })
})
