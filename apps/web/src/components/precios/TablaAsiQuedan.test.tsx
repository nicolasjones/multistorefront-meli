import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ imagenes: new Map<string, string>() }))

vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: () => mocks.imagenes }))

import type { FilaPrevia } from '../../lib/precios'
import { TablaAsiQuedan } from './TablaAsiQuedan'

const fila = (n: number): FilaPrevia => ({
  productoId: `p-${n}`, nombre: `Producto ${n}`, sku: `SKU-${n}`, moneda: 'ARS', centralArs: 100, netoArs: 90, finalArs: 109,
})

describe('TablaAsiQuedan', () => {
  it('muestra la imagen principal del producto como miniatura junto al nombre', () => {
    mocks.imagenes.set('p-1', 'https://ejemplo/p1.png')
    const { container, getByText } = render(
      <TablaAsiQuedan nombreEmpresa="San Javucho" mostrarConIva={false} filas={[fila(1), fila(2)]} cargando={false} hayError={false} ajusteInvalido={false} reintentar={vi.fn()} />,
    )
    expect(getByText('Producto 2')).toBeInTheDocument()
    expect(container.querySelector('img[src="https://ejemplo/p1.png"]')).not.toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })
})
