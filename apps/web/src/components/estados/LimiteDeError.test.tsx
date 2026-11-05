import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LimiteDeError } from './LimiteDeError'

let romper = true
function Hijo() {
  if (romper) throw new Error('falló el hijo')
  return <p>todo bien</p>
}

describe('LimiteDeError', () => {
  it('muestra el error en lugar de caerse y permite reintentar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    romper = true
    render(<LimiteDeError titulo="No pudimos mostrar esta sección."><Hijo /></LimiteDeError>)
    expect(screen.getByText('No pudimos mostrar esta sección.')).toBeInTheDocument()
    expect(screen.getByText('falló el hijo')).toBeInTheDocument()
    romper = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('todo bien')).toBeInTheDocument()
  })

  it('sin errores muestra el contenido', () => {
    romper = false
    render(<LimiteDeError><Hijo /></LimiteDeError>)
    expect(screen.getByText('todo bien')).toBeInTheDocument()
  })
})
