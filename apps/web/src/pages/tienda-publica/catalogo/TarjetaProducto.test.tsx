import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TarjetaProducto } from './TarjetaProducto'

// F-CLI-07 (FR-030, FR-032): las tarjetas del catálogo siguen mostrando el precio x1 público de hoy; el tipo
// de cliente solo cambia la ficha. Visitante, cuenta suspendida, sin cuenta y no habilitada no se distinguen
// de un minorista o mayorista en la tarjeta: la tarjeta no recibe nada del cliente.
const producto = { id: 'a1000000-0000-4000-8000-000000000001', nombre: 'Joystick Pro', precio: 18455, disponible: true, imagen: null, categoriaId: null, destacado: false }

function montar() {
  return render(<MemoryRouter><TarjetaProducto producto={producto} /></MemoryRouter>)
}

describe('TarjetaProducto · sin regresión de precio', () => {
  it('muestra el precio público x1 y enlaza a la ficha', () => {
    montar()
    expect(screen.getByText('$ 18.455')).toBeInTheDocument()
    expect(screen.getByTestId('tarjeta-producto')).toHaveAttribute('href', `/producto/${producto.id}`)
  })

  it.each(['visitante', 'cuenta suspendida', 'sin cuenta', 'no habilitada', 'minorista', 'mayorista'])(
    'para %s la tarjeta es idéntica (un solo precio, sin escalas)',
    () => {
      montar()
      expect(screen.getAllByText(/^\$ /)).toHaveLength(1)
      expect(screen.queryByText(/x5|x10|x50/)).not.toBeInTheDocument()
    },
  )
})
