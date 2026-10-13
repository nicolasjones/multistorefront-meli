import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AccesoRestringido } from './AccesoRestringido'

function renderizar() {
  return render(
    <MemoryRouter>
      <AccesoRestringido rol="Operador" seccion="Rentabilidad" />
    </MemoryRouter>,
  )
}

describe('AccesoRestringido (F-ROL-03)', () => {
  it('muestra el título y el motivo con el rol y la sección reales', () => {
    renderizar()

    expect(screen.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toBeInTheDocument()
    expect(
      screen.getByText('Tu rol (Operador) no incluye Rentabilidad. Pedile acceso a un administrador.'),
    ).toBeInTheDocument()
  })

  it('«Volver al inicio» es un enlace operable por teclado hacia la raíz', () => {
    renderizar()

    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
  })

  // US2 criterio 3 (spec.md): «Solicitar acceso» fuera de alcance; la persona
  // pide el acceso a un administrador, como dice el motivo.
  it('no ofrece «Solicitar acceso» y remite a un administrador', () => {
    renderizar()

    expect(screen.queryByText(/Solicitar acceso/)).not.toBeInTheDocument()
    expect(screen.getByText(/Pedile acceso a un administrador/)).toBeInTheDocument()
  })

  it('no repite el título de página en el estado vacío', () => {
    renderizar()

    expect(screen.queryByText('Acceso restringido')).not.toBeInTheDocument()
    expect(screen.getByText('Sección no disponible para tu rol')).toBeInTheDocument()
  })
})
