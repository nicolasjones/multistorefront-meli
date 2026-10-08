import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IdentidadVisible, resolverNombreVisible } from './IdentidadVisible'

describe('resolverNombreVisible', () => {
  it('combina nombre y apellido cuando ambos están completos', () => {
    expect(resolverNombreVisible({ nombre: 'Mia', apellido: 'Miembro' })).toEqual({
      nombreVisible: 'Mia Miembro',
      estadoIdentidad: 'resuelta',
    })
  })

  it('usa el único dato de perfil disponible', () => {
    expect(resolverNombreVisible({ nombre: 'Mia', apellido: null })).toEqual({
      nombreVisible: 'Mia',
      estadoIdentidad: 'incompleta',
    })
  })

  it('cae en "Perfil sin completar" cuando no hay ningún dato', () => {
    expect(resolverNombreVisible({ nombre: null, apellido: null })).toEqual({
      nombreVisible: 'Perfil sin completar',
      estadoIdentidad: 'incompleta',
    })
  })

  it('respeta los estados fijos de actor histórico y sistema sin importar nombre/apellido', () => {
    expect(resolverNombreVisible({ nombre: 'Mia', apellido: 'Miembro' }, 'eliminada').nombreVisible).toBe('Usuario eliminado')
    expect(resolverNombreVisible({}, 'sistema').nombreVisible).toBe('Sistema')
    expect(resolverNombreVisible({}, 'no_disponible').nombreVisible).toBe('Organización no disponible')
  })

  it('una organización con un único nombre está resuelta, no "incompleta" (T028: sin concepto de apellido)', () => {
    expect(resolverNombreVisible({ nombre: 'Estudio Acme' }, 'resuelta', 'organizacion')).toEqual({
      nombreVisible: 'Estudio Acme',
      estadoIdentidad: 'resuelta',
    })
  })

  it('una organización sin nombre resuelto cae en "Organización no disponible", nunca en el UUID', () => {
    expect(resolverNombreVisible({}, 'resuelta', 'organizacion')).toEqual({
      nombreVisible: 'Organización no disponible',
      estadoIdentidad: 'no_disponible',
    })
  })
})

describe('IdentidadVisible', () => {
  it('nunca renderiza un UUID como contenido ni como aria-label', () => {
    render(<IdentidadVisible nombre="Mia" apellido="Miembro" idTecnico="11111111-1111-1111-1111-111111111111" puedeCopiarIdTecnico={false} />)

    expect(screen.getByText('Mia Miembro')).toBeInTheDocument()
    expect(screen.queryByText('11111111-1111-1111-1111-111111111111')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('11111111-1111-1111-1111-111111111111')
  })

  it('no ofrece copiar el identificador técnico fuera de superadmin', () => {
    render(<IdentidadVisible nombre="Mia" apellido="Miembro" idTecnico="11111111-1111-1111-1111-111111111111" puedeCopiarIdTecnico={false} />)

    expect(screen.queryByRole('button', { name: /copiar identificador técnico/i })).not.toBeInTheDocument()
  })

  it('ofrece copiar el identificador técnico solo cuando puedeCopiarIdTecnico es verdadero', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<IdentidadVisible nombre="Mia" apellido="Miembro" idTecnico="11111111-1111-1111-1111-111111111111" puedeCopiarIdTecnico />)

    const boton = screen.getByRole('button', { name: 'Copiar identificador técnico de Mia Miembro' })
    fireEvent.click(boton)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111'))
  })

  it('sin idTecnico no ofrece el botón aunque puedeCopiarIdTecnico sea verdadero', () => {
    render(<IdentidadVisible nombre="Mia" apellido="Miembro" puedeCopiarIdTecnico />)

    expect(screen.queryByRole('button', { name: /copiar identificador técnico/i })).not.toBeInTheDocument()
  })

  it('marca el texto en itálica/secundario cuando el estado no está resuelto', () => {
    render(<IdentidadVisible estado="eliminada" />)

    const texto = screen.getByText('Usuario eliminado')
    expect(texto).toHaveStyle({ fontStyle: 'italic' })
  })
})
