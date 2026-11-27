import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@mui/material'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { temaPanel } from '../../../tema/temaPanel'
import { CLAVE_MODO_INICIO, ModoOscuroInicio } from '../ModoOscuroInicio'

function Sonda() {
  const tema = useTheme()
  return <p>modo {tema.palette.mode} papel {tema.palette.background.paper}</p>
}

const montar = () => render(<ThemeProvider theme={temaPanel}><ModoOscuroInicio><Sonda /></ModoOscuroInicio></ThemeProvider>)

describe('Modo oscuro del tablero de Inicio (RF-INI-04-7)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('arranca en claro, el interruptor tiene nombre accesible y no cambia el tema del contenido', () => {
    montar()
    expect(screen.getByRole('checkbox', { name: 'Modo oscuro' })).not.toBeChecked()
    expect(screen.getByText(/modo light/)).toBeInTheDocument()
    expect(document.querySelector('[data-modo="oscuro"]')).toBeNull()
  })

  it('al activarlo el contenido recibe el tema oscuro y se recuerda; al apagarlo vuelve', () => {
    montar()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modo oscuro' }))
    expect(screen.getByText(/modo dark papel #1B1F26/)).toBeInTheDocument()
    expect(document.querySelector('[data-modo="oscuro"]')).not.toBeNull()
    expect(window.localStorage.getItem(CLAVE_MODO_INICIO)).toBe('1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modo oscuro' }))
    expect(screen.getByText(/modo light/)).toBeInTheDocument()
    expect(window.localStorage.getItem(CLAVE_MODO_INICIO)).toBe('0')
  })

  it('recuerda la elección al volver a montar (solo el valor «1» activa el modo)', () => {
    window.localStorage.setItem(CLAVE_MODO_INICIO, '1')
    montar()
    expect(screen.getByRole('checkbox', { name: 'Modo oscuro' })).toBeChecked()
    expect(screen.getByText(/modo dark/)).toBeInTheDocument()
  })

  it('un valor guardado distinto de «1» (0, vacío, basura) arranca en claro', () => {
    for (const valor of ['0', '', 'true', '2']) {
      window.localStorage.setItem(CLAVE_MODO_INICIO, valor)
      const { unmount } = montar()
      expect(screen.getByRole('checkbox', { name: 'Modo oscuro' }), valor).not.toBeChecked()
      unmount()
    }
  })

  it('sin almacenamiento (lanza al leer y al escribir) funciona y arranca en claro', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    montar()
    expect(screen.getByRole('checkbox', { name: 'Modo oscuro' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modo oscuro' }))
    expect(screen.getByText(/modo dark/)).toBeInTheDocument()
  })

  it('no tiene violaciones de axe en claro ni en oscuro (el contraste numérico se prueba en coloresOscuros.test.ts)', async () => {
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modo oscuro' }))
    expect(await violacionesAxe(container)).toEqual([])
  })
})
