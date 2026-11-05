import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FORMULARIO_CLIENTE_VACIO } from '../../lib/clientes'
import { FormularioCliente } from './FormularioCliente'

// Dentro del popup «Nuevo cliente» / «Editar cliente» no se navega: Cancelar avisa con onCancelar.
describe('FormularioCliente · popup', () => {
  it('con onCancelar, «Cancelar» es un botón que avisa en vez de navegar', () => {
    const onCancelar = vi.fn()
    render(
      <MemoryRouter>
        <FormularioCliente inicial={FORMULARIO_CLIENTE_VACIO} etiquetaGuardar="Crear cliente" onGuardar={vi.fn()} rutaCancelar="/clientes" onCancelar={onCancelar} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalledTimes(1)
  })

  it('sin onCancelar, «Cancelar» sigue siendo un enlace al listado', () => {
    render(
      <MemoryRouter>
        <FormularioCliente inicial={FORMULARIO_CLIENTE_VACIO} etiquetaGuardar="Crear cliente" onGuardar={vi.fn()} rutaCancelar="/clientes" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Cancelar' })).toHaveAttribute('href', '/clientes')
  })
})
