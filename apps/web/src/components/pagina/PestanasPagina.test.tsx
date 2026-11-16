import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { PestanasPagina } from './PestanasPagina'

const PESTANAS = [
  { etiqueta: 'Resumen', to: '/rentabilidad' },
  { etiqueta: 'Por producto', to: '/rentabilidad/productos' },
  { etiqueta: 'Historia', to: '/rentabilidad/historia' },
]

function abrirEn(ruta: string) {
  window.history.pushState({}, '', ruta)
  render(<PestanasPagina pestanas={PESTANAS} etiqueta="Secciones" />)
}

describe('PestanasPagina', () => {
  afterEach(() => window.history.pushState({}, '', '/'))

  it('en la ruta base marca la primera pestaña', () => {
    abrirEn('/rentabilidad')
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true')
  })

  it('en una subruta marca esa pestaña y no la primera, aunque la ruta base sea prefijo', () => {
    abrirEn('/rentabilidad/historia')
    expect(screen.getByRole('tab', { name: 'Historia' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'false')
  })

  it('también marca la pestaña cuando la ruta tiene un tramo más (detalle)', () => {
    abrirEn('/rentabilidad/productos/abc')
    expect(screen.getByRole('tab', { name: 'Por producto' })).toHaveAttribute('aria-selected', 'true')
  })

  describe('dentro de un router (navegación interna)', () => {
    const verEn = (ruta: string) =>
      render(
        <MemoryRouter initialEntries={[ruta]}>
          <Routes>
            <Route path="*" element={<><PestanasPagina pestanas={PESTANAS} etiqueta="Secciones" /><p>contenido</p></>} />
          </Routes>
        </MemoryRouter>,
      )

    it('marca la pestaña de la ruta actual (la más específica)', () => {
      verEn('/rentabilidad/historia')
      expect(screen.getByRole('tab', { name: 'Historia' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'false')
    })

    it('al hacer clic cambia de pestaña sin recargar la página', () => {
      verEn('/rentabilidad')
      const sinRecarga = fireEvent.click(screen.getByRole('tab', { name: 'Por producto' }))
      // `fireEvent.click` devuelve false si alguien llamó a preventDefault: el router intercepta el clic del enlace.
      expect(sinRecarga).toBe(false)
      expect(screen.getByRole('tab', { name: 'Por producto' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tab', { name: 'Por producto' })).toHaveAttribute('href', '/rentabilidad/productos')
    })
  })
})
