import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Previsualizacion } from '../../lib/cotizacion'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'

const PREVIA: Previsualizacion = {
  variacionPct: 5,
  recalcula: true,
  empresas: [
    { empresaId: 'e1', nombre: 'Mundo JC', precios: 38 },
    { empresaId: 'e2', nombre: 'San Javucho', precios: 1 },
  ],
  muestra: [
    {
      producto: 'Joystick Pro cableado',
      sku: '5134a',
      usd: 19.92,
      porEmpresa: [{ empresaId: 'e1', hoy: 29190, nuevo: 30650 }, { empresaId: 'e2', hoy: null, nuevo: null }],
    },
    { producto: 'Case OLED', sku: null, usd: 11, porEmpresa: [{ empresaId: 'e1', hoy: 16116, nuevo: 16900 }] },
  ],
}

describe('BloqueQueVaACambiar', () => {
  it('muestra un mosaico por empresa con la cantidad de precios en USD visibles', () => {
    render(<BloqueQueVaACambiar previa={PREVIA} />)
    expect(screen.getByRole('heading', { name: 'Qué va a cambiar' })).toBeInTheDocument()
    expect(screen.getByText('38 precios')).toBeInTheDocument()
    expect(screen.getByText('1 precio')).toBeInTheDocument()
    expect(screen.getAllByText('productos en USD visibles')).toHaveLength(2)
  })

  it('la tabla tiene «Producto (muestra)» y «<Empresa> hoy» / «Nuevo» por empresa', () => {
    render(<BloqueQueVaACambiar previa={PREVIA} />)
    const tabla = screen.getByRole('table', { name: 'Productos de muestra con su precio de hoy y el nuevo' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((c) => c.textContent)
    expect(encabezados).toEqual(['Producto (muestra)', 'Mundo JC hoy', 'Nuevo', 'San Javucho hoy', 'Nuevo'])
  })

  it('cada fila trae el producto, su SKU y USD, y los precios de hoy y nuevo', () => {
    render(<BloqueQueVaACambiar previa={PREVIA} />)
    const filas = screen.getAllByRole('row').slice(1)
    expect(within(filas[0]).getByText('Joystick Pro cableado')).toBeInTheDocument()
    expect(within(filas[0]).getByText('5134a · US$ 19,92')).toBeInTheDocument()
    expect(within(filas[0]).getByText('$ 29.190')).toBeInTheDocument()
    expect(within(filas[0]).getByText('$ 30.650')).toBeInTheDocument()
  })

  it('un precio sin dato (USD sin cotización o empresa sin fila) se ve «—», nunca un valor inventado', () => {
    render(<BloqueQueVaACambiar previa={PREVIA} />)
    const filas = screen.getAllByRole('row').slice(1)
    expect(within(filas[0]).getAllByText('—')).toHaveLength(2)
    expect(within(filas[1]).getAllByText('—')).toHaveLength(2)
    expect(within(filas[1]).getByText('11,00', { exact: false })).toBeInTheDocument()
  })

  it('cierra con la nota del redondeo y sin muestra no dibuja la tabla', () => {
    render(<BloqueQueVaACambiar previa={{ ...PREVIA, muestra: [] }} />)
    expect(screen.getByText('Redondeo al $ 10 más cercano.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
