import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { PaginaTienda, type ModuloSeccionTienda } from './PaginaTienda'
import { VolvemosPronto } from './VolvemosPronto'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }

const seccion = (texto: string, orden: number): ModuloSeccionTienda => ({
  orden,
  default: () => <p>{texto}</p>,
})

describe('PaginaTienda (FR-007, SC-011)', () => {
  it('ordena las secciones por `orden`', () => {
    render(
      <PaginaTienda
        tienda={tienda}
        host="mundojc.localhost"
        modulos={{ './secciones/b.tsx': seccion('Segunda', 20), './secciones/a.tsx': seccion('Primera', 10) }}
      />,
    )

    const textos = screen.getAllByRole('paragraph').map((nodo) => nodo.textContent)
    expect(textos).toEqual(['Primera', 'Segunda'])
  })

  it('muestra el nombre comercial como título de la tienda', () => {
    render(<PaginaTienda tienda={tienda} host="mundojc.localhost" modulos={{}} />)
    expect(screen.getByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
  it('la página de la tienda no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    const { container } = render(<PaginaTienda tienda={tienda} host="mundojc.localhost" modulos={{ './secciones/a.tsx': seccion('Sección', 10) }} />)
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('«Volvemos pronto» no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    const { container } = render(<VolvemosPronto />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('VolvemosPronto (FR-003)', () => {
  it('muestra el mismo mensaje para dominio desconocido y tienda desactivada', () => {
    render(<VolvemosPronto />)
    expect(screen.getByRole('heading', { name: 'Volvemos pronto' })).toBeInTheDocument()
    expect(screen.getByText('Estamos preparando esta tienda. Volvé a visitarnos en un rato.')).toBeInTheDocument()
  })
})
