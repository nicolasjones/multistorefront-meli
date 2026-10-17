import { ThemeProvider } from '@mui/material'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { temaPanel } from '../../tema/temaPanel'
import { tokens } from '../../tema/tokens'
import { MiniaturaProducto } from './MiniaturaProducto'

const conTema = (ui: ReactNode) => render(<ThemeProvider theme={temaPanel}>{ui}</ThemeProvider>)

describe('MiniaturaProducto (FR-005)', () => {
  it('renderiza la imagen con la medida .thumb del prototipo', () => {
    conTema(<MiniaturaProducto alt="Producto" src="https://ejemplo/imagen.png" />)
    const imagen = screen.getByRole('img', { name: 'Producto' })
    expect(imagen).toHaveStyle({
      width: `${tokens.forma.ladoMiniatura}px`,
      height: `${tokens.forma.ladoMiniatura}px`,
      borderRadius: `${tokens.forma.radioMiniatura}px`,
    })
  })

  it('sin imagen deja un marcador decorativo del mismo tamaño', () => {
    conTema(<MiniaturaProducto alt="Producto" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const marcador = document.querySelector('[aria-hidden="true"]')
    expect(marcador).toHaveStyle({ backgroundColor: tokens.color.fondo, width: `${tokens.forma.ladoMiniatura}px` })
  })
})
