import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContenidoAdaptable, type ColumnaAdaptable } from './ContenidoAdaptable'

type Fila = { id: string; nombre: string; estado: string }

const filas: Fila[] = [
  { id: '1', nombre: 'Cliente uno', estado: 'activo' },
  { id: '2', nombre: 'Cliente dos', estado: 'inactivo' },
]

const columnas: ColumnaAdaptable<Fila>[] = [
  { clave: 'nombre', encabezado: 'Nombre', render: (fila) => fila.nombre },
  { clave: 'estado', encabezado: 'Estado', render: (fila) => fila.estado },
]

function mockAnchoPantalla(coincideAngosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coincideAngosta,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('ContenidoAdaptable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renderiza una tabla accesible en pantallas anchas (T039)', () => {
    mockAnchoPantalla(false)

    render(
      <ContenidoAdaptable
        items={filas}
        columnas={columnas}
        obtenerClave={(fila) => fila.id}
        acciones={(fila) => <button type="button">Editar {fila.nombre}</button>}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Estado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Cliente uno' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Cliente dos' })).toBeInTheDocument()
  })

  it('condensa el contenido en tarjetas en pantallas angostas sin perder las acciones de fila (T039)', () => {
    mockAnchoPantalla(true)

    render(
      <ContenidoAdaptable
        items={filas}
        columnas={columnas}
        obtenerClave={(fila) => fila.id}
        acciones={(fila) => <button type="button">Editar {fila.nombre}</button>}
      />,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Cliente uno')).toBeInTheDocument()
    expect(screen.getByText('activo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Cliente uno' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Cliente dos' })).toBeInTheDocument()
  })

  it('omite columnas marcadas como ocultarEnTarjeta al condensar en tarjetas', () => {
    mockAnchoPantalla(true)

    const columnasConOculta: ColumnaAdaptable<Fila>[] = [
      ...columnas,
      { clave: 'id', encabezado: 'Identificador técnico', render: (fila) => fila.id, ocultarEnTarjeta: true },
    ]

    render(<ContenidoAdaptable items={filas} columnas={columnasConOculta} obtenerClave={(fila) => fila.id} />)

    expect(screen.queryByText('Identificador técnico')).not.toBeInTheDocument()
  })
})
