import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContenedorSeccion } from './ContenedorSeccion'

describe('ContenedorSeccion', () => {
  it('renderiza su contenido dentro de un único contorno visual (US5)', () => {
    render(
      <ContenedorSeccion>
        <p>Contenido de la sección</p>
      </ContenedorSeccion>,
    )

    const contenido = screen.getByText('Contenido de la sección')
    expect(contenido).toBeInTheDocument()
    expect(contenido.closest('.MuiCard-root')).not.toBeNull()
  })

  it('no impone ningún rol ni texto propio — es un contenedor puro', () => {
    render(
      <ContenedorSeccion>
        <table>
          <caption>Tabla de prueba</caption>
        </table>
      </ContenedorSeccion>,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
