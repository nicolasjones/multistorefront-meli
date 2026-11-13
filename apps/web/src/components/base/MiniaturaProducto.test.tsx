import { ThemeProvider } from '@mui/material'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('al pasar el mouse muestra la imagen ampliada y al salir la quita', () => {
    conTema(<MiniaturaProducto alt="Producto" src="https://ejemplo/imagen.png" />)
    const imagen = screen.getByRole('img', { name: 'Producto' })
    expect(document.querySelectorAll('img')).toHaveLength(1)
    fireEvent.mouseEnter(imagen)
    const imagenes = document.querySelectorAll('img')
    expect(imagenes).toHaveLength(2)
    expect(imagenes[1]).toHaveAttribute('src', 'https://ejemplo/imagen.png')
    expect(imagenes[1]).toHaveStyle({ width: '280px', height: '280px' })
    fireEvent.mouseLeave(imagen)
    expect(document.querySelectorAll('img')).toHaveLength(1)
  })

  it('sin imagen no hay zoom', () => {
    conTema(<MiniaturaProducto alt="Producto" />)
    const marcador = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseEnter(marcador)
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('la imagen se carga de forma diferida y asíncrona (listados largos)', () => {
    conTema(<MiniaturaProducto alt="Producto" src="https://ejemplo/imagen.png" />)
    const imagen = screen.getByRole('img', { name: 'Producto' })
    expect(imagen).toHaveAttribute('loading', 'lazy')
    expect(imagen).toHaveAttribute('decoding', 'async')
  })

  it('si la imagen no carga (URL firmada vencida) queda el recuadro vacío y no una imagen rota', () => {
    conTema(<MiniaturaProducto alt="Producto" src="https://ejemplo/vencida.png" />)
    fireEvent.error(screen.getByRole('img', { name: 'Producto' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
