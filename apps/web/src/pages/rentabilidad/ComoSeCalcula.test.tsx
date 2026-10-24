import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComoSeCalcula, TEXTO_ESTIMACION } from './ComoSeCalcula'

const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho' },
  { id: 'e2', nombre: 'Mundo JC' },
]

describe('ComoSeCalcula', () => {
  it('muestra las fórmulas y la aclaración de estimación', () => {
    render(<ComoSeCalcula empresas={EMPRESAS} />)
    expect(screen.getByRole('heading', { name: 'Cómo se calcula' })).toBeInTheDocument()
    expect(screen.getByText('Margen = Precio − Costo − Comisión')).toBeInTheDocument()
    expect(screen.getByText('Margen % = Margen ÷ Precio')).toBeInTheDocument()
    expect(screen.getByText(TEXTO_ESTIMACION)).toBeInTheDocument()
    expect(TEXTO_ESTIMACION).toBe('Estimación con los datos disponibles: no incluye impuestos, envíos ni otros costos.')
  })

  it('tiene una fila por tienda con sus columnas y sin Mercado Libre', () => {
    render(<ComoSeCalcula empresas={EMPRESAS} />)
    const tabla = screen.getByRole('table', { name: 'Precio y comisión por canal' })
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Canal', 'Precio usado', 'Comisión / costo disponible',
    ])
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas).toHaveLength(2)
    expect(within(filas[0]).getByText('San Javucho')).toBeInTheDocument()
    expect(within(filas[0]).getByText('Sin comisión: no hay checkout ni pagos en esta versión')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Mundo JC')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Sin comisión')).toBeInTheDocument()
    expect(screen.queryByText(/Mercado Libre/)).not.toBeInTheDocument()
    expect(screen.queryByText(/14,5/)).not.toBeInTheDocument()
  })
})
