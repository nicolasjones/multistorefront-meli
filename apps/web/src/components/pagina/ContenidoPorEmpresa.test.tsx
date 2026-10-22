import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { avisarCambioEmpresaActiva } from '../../lib/cambioEmpresaActiva'
import { ContenidoPorEmpresa } from './ContenidoPorEmpresa'

function Campo() {
  const [valor, setValor] = useState('inicial')
  return <input aria-label="campo" value={valor} onChange={(evento) => setValor(evento.target.value)} />
}

describe('ContenidoPorEmpresa', () => {
  it('remonta la pantalla al cambiar la empresa activa', () => {
    render(<ContenidoPorEmpresa><Campo /></ContenidoPorEmpresa>)
    fireEvent.change(screen.getByLabelText('campo'), { target: { value: 'editado' } })
    expect((screen.getByLabelText('campo') as HTMLInputElement).value).toBe('editado')
    act(() => { avisarCambioEmpresaActiva() })
    expect((screen.getByLabelText('campo') as HTMLInputElement).value).toBe('inicial')
  })
})
