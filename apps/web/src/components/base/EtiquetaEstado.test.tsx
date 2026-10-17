import { ThemeProvider } from '@mui/material'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { temaPanel } from '../../tema/temaPanel'
import { tokens } from '../../tema/tokens'
import { EtiquetaEstado, type VarianteEtiqueta } from './EtiquetaEstado'

const conTema = (ui: ReactNode) => render(<ThemeProvider theme={temaPanel}>{ui}</ThemeProvider>)

describe('EtiquetaEstado (FR-006)', () => {
  it.each<[VarianteEtiqueta, string, string]>([
    ['neutral', '#EEEDE8', '#3B4048'],
    ['primario', '#E4EAFD', '#1E3FB8'],
    ['exito', '#E1F3E7', '#146B35'],
    ['aviso', '#FCECD0', '#7A4B00'],
    ['error', '#FBE2E2', '#9B1C1C'],
    ['info', '#E2EFFA', '#0B4F82'],
  ])('usa los tonos .chip del prototipo para %s', (variante, fondo, texto) => {
    conTema(<EtiquetaEstado texto="Estado" variante={variante} />)
    const chip = screen.getByText('Estado').closest('.MuiChip-root')
    expect(chip).toHaveStyle({ backgroundColor: fondo, color: texto, borderRadius: `${tokens.forma.radioEtiqueta}px` })
  })

  it('la variante contorno (.chip.o) agrega el borde del prototipo', () => {
    conTema(<EtiquetaEstado texto="Estado" variante="contorno" />)
    const chip = screen.getByText('Estado').closest('.MuiChip-root')
    expect(chip).toHaveStyle({ backgroundColor: '#FFFFFF', color: '#5F6670', border: '1px solid #D9D8D2' })
  })

  it('es una píldora de 24 px de alto', () => {
    conTema(<EtiquetaEstado texto="Estado" />)
    const chip = screen.getByText('Estado').closest('.MuiChip-root')
    expect(chip).toHaveStyle({ height: '24px' })
  })
})
