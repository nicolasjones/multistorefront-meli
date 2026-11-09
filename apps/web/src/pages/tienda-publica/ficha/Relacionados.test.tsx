import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))

vi.mock('../../../lib/tiendaRelacionados', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/tiendaRelacionados')>()
  const { useEffect, useState } = await import('react')
  // Se reemplaza solo la lectura de red; el hook real corre con esta función.
  return {
    ...real,
    useRelacionados: (host: string, productoId: string) => {
      const [estado, setEstado] = useState<import('../../../lib/tiendaRelacionados').EstadoRelacionados>({ fase: 'cargando' })
      useEffect(() => {
        mocks.leer(host, productoId).then(
          (r: { productos: unknown[]; imagenes: Record<string, string> }) => setEstado(r.productos.length === 0 ? { fase: 'vacia' } : { fase: 'lista', ...r } as never),
          () => setEstado({ fase: 'error' }),
        )
      }, [host, productoId])
      return estado
    },
  }
})

import Relacionados from './Relacionados'

// F-TDA-20 (FR-011, FR-012, SC-005): título y tarjetas con enlace a la ficha, ausencia sin relacionados o si
// falla el pedido, columnas 2 / 4 y accesibilidad.
const ID = 'a1000000-0000-4000-8000-000000000001'
const producto = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `a1000000-0000-4000-8000-00000000010${n}`, nombre: `Rel ${n}`, precio: 1000 * n, disponible: true, imagen: null, categoriaId: 'c1', destacado: false, ...extra,
})

function montar() {
  return render(<MemoryRouter><Relacionados host="mundojc.localhost" productoId={ID} /></MemoryRouter>)
}

describe('Relacionados', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra el título y una tarjeta por producto que enlaza a su ficha, con «Sin stock» y «Sin imagen»', async () => {
    mocks.leer.mockResolvedValue({ productos: [producto(1), producto(2, { disponible: false })], imagenes: {} })
    montar()
    expect(await screen.findByRole('heading', { level: 2, name: 'Productos relacionados' })).toBeInTheDocument()
    const tarjetas = screen.getAllByTestId('tarjeta-producto')
    expect(tarjetas).toHaveLength(2)
    expect(tarjetas[0]).toHaveAttribute('href', '/producto/a1000000-0000-4000-8000-000000000101')
    expect(within(tarjetas[1]).getByText('Sin stock')).toBeInTheDocument()
    expect(within(tarjetas[0]).getByText('Sin imagen')).toBeInTheDocument()
  })

  it('usa 2 columnas en celular y 4 en escritorio', async () => {
    mocks.leer.mockResolvedValue({ productos: [producto(1)], imagenes: {} })
    montar()
    await screen.findByText('Productos relacionados')
    const rejilla = screen.getByTestId('tarjeta-producto').parentElement as HTMLElement
    const reglas = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')
    expect(rejilla.className).toBeTruthy()
    expect(reglas).toContain('repeat(2, minmax(0, 1fr))')
    // 4 columnas desde `sm` (600 px): a 768 px ya son 4, no 2 (FR-012).
    expect(reglas).toMatch(/@media \(min-width:600px\)\{[^}]*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/)
    expect(reglas).not.toMatch(/min-width:900px[^}]*\{[^}]*repeat\(4/)
  })

  it('mientras carga muestra un estado discreto sin título', () => {
    mocks.leer.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(screen.getByTestId('relacionados-cargando')).toBeInTheDocument()
    expect(screen.queryByText('Productos relacionados')).not.toBeInTheDocument()
  })

  it('sin relacionados no renderiza nada (ni título ni hueco)', async () => {
    mocks.leer.mockResolvedValue({ productos: [], imagenes: {} })
    const { container } = montar()
    await waitFor(() => expect(screen.queryByTestId('relacionados-cargando')).not.toBeInTheDocument())
    expect(container).toBeEmptyDOMElement()
  })

  it('si el pedido falla la sección se omite sin mensaje', async () => {
    mocks.leer.mockRejectedValue(new Error('caído'))
    const { container } = montar()
    await waitFor(() => expect(screen.queryByTestId('relacionados-cargando')).not.toBeInTheDocument())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    mocks.leer.mockResolvedValue({ productos: [producto(1), producto(2)], imagenes: {} })
    const { container } = montar()
    await screen.findByText('Productos relacionados')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
