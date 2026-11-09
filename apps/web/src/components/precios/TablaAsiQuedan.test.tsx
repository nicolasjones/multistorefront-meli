import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ imagenes: new Map<string, string>() }))

vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: () => mocks.imagenes }))

import { violacionesAxe } from '../../test/axe'
import type { FilaPrevia } from '../../lib/precios'
import { TablaAsiQuedan } from './TablaAsiQuedan'

const fila = (n: number, cambios: Partial<FilaPrevia> = {}): FilaPrevia => ({
  productoId: `p-${n}`, nombre: `Producto ${n}`, sku: `SKU-${n}`, moneda: 'ARS', centralArs: 100, netoArs: 90, finalArs: 109, precioPropio: false,
  ...cambios,
})

type Props = Partial<Parameters<typeof TablaAsiQuedan>[0]>
const montar = (props: Props = {}) =>
  render(
    <MemoryRouter>
      <TablaAsiQuedan
        nombreEmpresa="San Javucho"
        mostrarConIva={false}
        filas={[fila(1), fila(2)]}
        cargando={false}
        hayError={false}
        ajusteInvalido={false}
        reintentar={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
const marcasDe = (producto: string) => within(screen.getByText(producto).closest('tr') as HTMLElement)

describe('TablaAsiQuedan', () => {
  it('muestra la imagen principal del producto como miniatura junto al nombre', () => {
    mocks.imagenes.set('p-1', 'https://ejemplo/p1.png')
    const { container } = montar()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(container.querySelector('img[src="https://ejemplo/p1.png"]')).not.toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  describe('marca por fila (F-PRE-09, FR-024)', () => {
    it('sin ajuste, todo lo que sigue la regla es «Central»', () => {
      montar()
      expect(marcasDe('Producto 1').getByText('Central')).toBeInTheDocument()
      expect(marcasDe('Producto 2').getByText('Central')).toBeInTheDocument()
    })

    it('con un ajuste en pantalla, lo que sigue la regla pasa a «Ajustado»', () => {
      montar({ hayAjuste: true })
      expect(marcasDe('Producto 1').getByText('Ajustado')).toBeInTheDocument()
      expect(marcasDe('Producto 2').getByText('Ajustado')).toBeInTheDocument()
    })

    it('el precio propio manda sobre el ajuste: se marca «Precio propio» aunque haya ajuste', () => {
      montar({ hayAjuste: true, filas: [fila(1, { precioPropio: true, netoArs: 25000 }), fila(2)] })
      expect(marcasDe('Producto 1').getByText('Precio propio')).toBeInTheDocument()
      expect(marcasDe('Producto 1').queryByText('Ajustado')).not.toBeInTheDocument()
      expect(marcasDe('Producto 2').getByText('Ajustado')).toBeInTheDocument()
    })

    it('el valor de la fila con precio propio no cambia al mover el ajuste', () => {
      const propio = fila(1, { precioPropio: true, netoArs: 25000, finalArs: 30250 })
      const { rerender } = montar({ filas: [propio, fila(2)] })
      expect(marcasDe('Producto 1').getByText('$ 25.000')).toBeInTheDocument()

      // El servidor devuelve la misma fila fija y la otra movida: la tabla solo pinta lo recibido.
      rerender(
        <MemoryRouter>
          <TablaAsiQuedan
            nombreEmpresa="San Javucho" mostrarConIva={false} hayAjuste cargando={false} hayError={false} ajusteInvalido={false}
            reintentar={vi.fn()} filas={[propio, fila(2, { netoArs: 103.5 })]}
          />
        </MemoryRouter>,
      )
      expect(marcasDe('Producto 1').getByText('$ 25.000')).toBeInTheDocument()
      expect(marcasDe('Producto 1').getByText('Precio propio')).toBeInTheDocument()
    })

    it('cada tono es distinto y el significado no depende solo del color (la marca lleva su texto)', () => {
      montar({ hayAjuste: true, filas: [fila(1, { precioPropio: true }), fila(2)] })
      const propio = marcasDe('Producto 1').getByText('Precio propio').closest('.MuiChip-root') as HTMLElement
      const ajustado = marcasDe('Producto 2').getByText('Ajustado').closest('.MuiChip-root') as HTMLElement
      expect(propio.className).toContain('MuiChip-colorPrimary')
      expect(ajustado.className).toContain('MuiChip-colorWarning')
      expect(propio.className).not.toBe(ajustado.className)
    })

    it('la columna de la marca tiene un encabezado accesible para lectores de pantalla', () => {
      montar()
      expect(screen.getByRole('columnheader', { name: 'Origen del precio' })).toBeInTheDocument()
    })
  })

  describe('precio según el interruptor de IVA (RF-PRE-09-2)', () => {
    it('sin IVA muestra el neto y rotula la columna', () => {
      montar({ filas: [fila(1, { netoArs: 90, finalArs: 109 })] })
      expect(screen.getByText('San Javucho · Sin IVA')).toBeInTheDocument()
      expect(screen.getByText('$ 90')).toBeInTheDocument()
    })
    it('con IVA muestra el final y rotula la columna', () => {
      montar({ mostrarConIva: true, filas: [fila(1, { netoArs: 90, finalArs: 109 })] })
      expect(screen.getByText('San Javucho · Con IVA incluido')).toBeInTheDocument()
      expect(screen.getByText('$ 109')).toBeInTheDocument()
    })
  })

  it('el subtítulo avisa que la tabla se actualiza con el ajuste (FR-022)', () => {
    montar()
    expect(screen.getByText('Se actualiza con el ajuste')).toBeInTheDocument()
  })

  describe('estados', () => {
    it('con error ofrece reintentar', () => {
      const reintentar = vi.fn()
      montar({ hayError: true, reintentar })
      fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }))
      expect(reintentar).toHaveBeenCalledTimes(1)
    })
    it('con el ajuste inválido espera la corrección en vez de mostrar filas', () => {
      montar({ ajusteInvalido: true })
      expect(screen.getByText('Corregí el ajuste')).toBeInTheDocument()
      expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    })
    it('sin productos lo dice', () => {
      montar({ filas: [] })
      expect(screen.getByText('Todavía no hay productos')).toBeInTheDocument()
    })
    it('sin cotización una fila muestra «sin precio» pero conserva su marca', () => {
      montar({ filas: [fila(1, { precioPropio: true, netoArs: null, finalArs: null })] })
      expect(screen.getByLabelText('Sin precio: falta cargar la cotización')).toBeInTheDocument()
      expect(marcasDe('Producto 1').getByText('Precio propio')).toBeInTheDocument()
    })
  })

  describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
    it('no tiene violaciones de axe con filas marcadas', async () => {
      window.innerWidth = ancho
      const { container } = montar({ hayAjuste: true, filas: [fila(1, { precioPropio: true }), fila(2)] })
      expect(await violacionesAxe(container)).toEqual([])
    })
  })
})
