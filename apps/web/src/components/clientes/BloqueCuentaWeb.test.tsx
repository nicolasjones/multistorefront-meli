import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import type { TiendaCuentaWeb } from '../../lib/cuentasCliente'
import { BloqueCuentaWeb } from './BloqueCuentaWeb'

const tienda = (extra: Partial<TiendaCuentaWeb> = {}): TiendaCuentaWeb => ({
  empresaId: 'e-1', nombre: 'San Javucho', habilitada: true, estado: 'activa',
  correo: 'compras@ejemplo.com', ultimoIngreso: '2026-10-05T18:20:00Z', ...extra,
})

const TIENDAS: TiendaCuentaWeb[] = [
  tienda(),
  tienda({ empresaId: 'e-2', nombre: 'Mundo JC', estado: 'suspendida', ultimoIngreso: null }),
]

function abrir(props: Partial<ComponentProps<typeof BloqueCuentaWeb>> = {}) {
  const acciones = {
    onSeleccionar: vi.fn(), onCrear: vi.fn(), onRestablecer: vi.fn(),
    onSuspender: vi.fn(), onReactivar: vi.fn(), onHabilitar: vi.fn(),
  }
  const utilidades = render(
    <BloqueCuentaWeb
      tiendas={TIENDAS}
      seleccionada="e-1"
      puedeEditar
      {...acciones}
      {...props}
    />,
  )
  return { ...utilidades, ...acciones }
}

describe('BloqueCuentaWeb (FR-013)', () => {
  it('muestra una pestaña por tienda y el estado con su texto, correo y último ingreso', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Cuenta web' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'San Javucho' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Puede ingresar a las tiendas con su correo.')).toBeInTheDocument()
    expect(screen.getByText('compras@ejemplo.com')).toBeInTheDocument()
    expect(screen.getByText(/Último ingreso: \d{2}\/\d{2}\/2026 · \d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('ofrece las acciones de una cuenta activa', () => {
    const { onRestablecer, onSuspender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer clave' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suspender acceso' }))
    expect(onRestablecer).toHaveBeenCalledWith('e-1')
    expect(onSuspender).toHaveBeenCalledWith('e-1')
  })

  it('una cuenta suspendida se reactiva y muestra su texto', () => {
    const { onReactivar } = abrir({ seleccionada: 'e-2' })
    expect(screen.getByText('No puede ingresar hasta que la reactives.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar acceso' }))
    expect(onReactivar).toHaveBeenCalledWith('e-2')
  })

  it('sin cuenta ofrece «Crear cuenta web» y la deshabilita con motivo si falta el correo', () => {
    const { onCrear, rerender } = abrir({ tiendas: [tienda({ estado: 'sin_cuenta', correo: null })], seleccionada: 'e-1' })
    expect(screen.getByText('El cliente compra sin registrarse.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cuenta web' })).toBeDisabled()
    expect(screen.getByText('Cargá un correo para crear la cuenta.')).toBeInTheDocument()
    expect(screen.queryByText('Correo de acceso')).not.toBeInTheDocument()
    expect(onCrear).not.toHaveBeenCalled()

    rerender(<BloqueCuentaWeb tiendas={[tienda({ estado: 'sin_cuenta' })]} seleccionada="e-1" puedeEditar onSeleccionar={vi.fn()} onCrear={onCrear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta web' }))
    expect(onCrear).toHaveBeenCalledWith('e-1')
  })

  it('no habilitado explica el motivo y ofrece habilitar en esa tienda', () => {
    const { onHabilitar } = abrir({ tiendas: [tienda({ habilitada: false, estado: 'no_habilitado' })], seleccionada: 'e-1' })
    expect(screen.getByText('El cliente no puede comprar en esta tienda.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Habilitar en San Javucho' }))
    expect(onHabilitar).toHaveBeenCalledWith('e-1')
  })

  it('sin edición muestra el estado pero no las acciones', () => {
    abrir({ puedeEditar: false })
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restablecer clave' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspender acceso' })).not.toBeInTheDocument()
  })

  it('cambiar de pestaña avisa qué tienda se quiere ver', () => {
    const { onSeleccionar } = abrir()
    fireEvent.click(screen.getByRole('tab', { name: 'Mundo JC' }))
    expect(onSeleccionar).toHaveBeenCalledWith('e-2')
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    const { container } = abrir()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
