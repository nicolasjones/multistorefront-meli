import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useBandera: vi.fn() }))
vi.mock('../../hooks/useBanderaMargenCostosFijos', () => ({ useBanderaMargenCostosFijos: mocks.useBandera }))

import { PestanasRentabilidad } from './PestanasRentabilidad'

const etiquetas = () => within(screen.getByRole('tablist', { name: 'Secciones de Rentabilidad' })).getAllByRole('tab').map((t) => t.textContent)
const montar = () => render(<MemoryRouter initialEntries={['/rentabilidad']}><PestanasRentabilidad /></MemoryRouter>)

describe('PestanasRentabilidad', () => {
  it('con la bandera apagada las pestañas son las de siempre (CA-GAS-15)', () => {
    mocks.useBandera.mockReturnValue({ activa: false, cargando: false })
    montar()
    expect(etiquetas()).toEqual(['Resumen', 'Por producto', 'Comparativo', 'Historia', 'Ventas reales', 'Costos adicionales'])
  })

  it('con la bandera encendida suma «Después de costos fijos» al final, hacia su ruta', () => {
    mocks.useBandera.mockReturnValue({ activa: true, cargando: false })
    montar()
    expect(etiquetas()).toEqual(['Resumen', 'Por producto', 'Comparativo', 'Historia', 'Ventas reales', 'Costos adicionales', 'Después de costos fijos'])
    expect(screen.getByRole('tab', { name: 'Después de costos fijos' })).toHaveAttribute('href', '/rentabilidad/costos-fijos')
  })

  it('mientras lee la bandera no muestra la pestaña', () => {
    mocks.useBandera.mockReturnValue({ activa: false, cargando: true })
    montar()
    expect(etiquetas()).not.toContain('Después de costos fijos')
  })
})
