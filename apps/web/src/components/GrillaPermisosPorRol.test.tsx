import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GrillaPermisosPorRol } from './GrillaPermisosPorRol'

const roles = [
  { id: 'administrador', descripcion: 'Administrador' },
  { id: 'miembro', descripcion: 'Miembro' },
]

describe('GrillaPermisosPorRol', () => {
  it('renderiza la columna administrador siempre tildada y deshabilitada', () => {
    render(<GrillaPermisosPorRol roles={roles} rolesSeleccionados={[]} onChange={vi.fn()} />)

    const checkboxAdministrador = screen.getByRole('checkbox', { name: 'Administrador' })
    expect(checkboxAdministrador).toBeChecked()
    expect(checkboxAdministrador).toBeDisabled()
  })

  it('togglear un rol dispara onChange con el conjunto correcto', () => {
    const onChange = vi.fn()
    render(<GrillaPermisosPorRol roles={roles} rolesSeleccionados={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Miembro' }))

    expect(onChange).toHaveBeenCalledWith(['miembro'])
  })

  it('destildar un rol ya seleccionado lo saca del conjunto', () => {
    const onChange = vi.fn()
    render(
      <GrillaPermisosPorRol roles={roles} rolesSeleccionados={['miembro']} onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Miembro' }))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
