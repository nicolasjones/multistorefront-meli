import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EncabezadoPagina } from './EncabezadoPagina'

describe('EncabezadoPagina', () => {
  it('expone el título como encabezado principal de la pantalla (T038)', () => {
    render(<EncabezadoPagina titulo="Clientes" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument()
  })

  it('muestra la descripción cuando se provee', () => {
    render(<EncabezadoPagina titulo="Clientes" descripcion="Administrá tu cartera." />)

    expect(screen.getByText('Administrá tu cartera.')).toBeInTheDocument()
  })

  it('no exige acción ni contexto para pantallas simples', () => {
    render(<EncabezadoPagina titulo="Reportes" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ubica la acción principal antes que el contexto en el orden del documento, que define el orden de foco por defecto', () => {
    render(
      <EncabezadoPagina
        titulo="Clientes"
        accion={<button type="button">Nuevo cliente</button>}
        contexto={<button type="button">Cambiar organización</button>}
      />,
    )

    const accion = screen.getByRole('button', { name: 'Nuevo cliente' })
    const contexto = screen.getByRole('button', { name: 'Cambiar organización' })

    expect(accion.compareDocumentPosition(contexto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('ubica el título antes que la acción en el orden del documento', () => {
    render(
      <EncabezadoPagina
        titulo="Clientes"
        accion={<button type="button">Nuevo cliente</button>}
      />,
    )

    const titulo = screen.getByRole('heading', { level: 1, name: 'Clientes' })
    const accion = screen.getByRole('button', { name: 'Nuevo cliente' })

    expect(titulo.compareDocumentPosition(accion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
