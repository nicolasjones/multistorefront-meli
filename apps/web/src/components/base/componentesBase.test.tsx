import { Button, TextField, ThemeProvider } from '@mui/material'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { temaPanel } from '../../tema/temaPanel'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { EtiquetaEstado } from './EtiquetaEstado'
import { TarjetaBase } from './TarjetaBase'

const conTema = (ui: ReactNode) => render(<ThemeProvider theme={temaPanel}>{ui}</ThemeProvider>)

describe('tema: botones y campos', () => {
  it('define tamaños de botón y estilos de campo desde los tokens', () => {
    const botones = temaPanel.components?.MuiButton?.styleOverrides as Record<string, Record<string, unknown>>
    expect(botones.root.minHeight).toBe(38)
    expect(botones.sizeSmall.minHeight).toBe(30)
    expect(botones.sizeLarge.minHeight).toBe(46)
    expect(temaPanel.components?.MuiTextField?.defaultProps).toMatchObject({ size: 'small' })
  })
})

describe('botón (normal / deshabilitado / foco)', () => {
  it('está habilitado por defecto, deshabilitado y recibe foco', () => {
    conTema(<><Button>Guardar</Button><Button disabled>Bloqueado</Button></>)
    const normal = screen.getByRole('button', { name: 'Guardar' })
    expect(normal).toBeEnabled()
    normal.focus()
    expect(normal).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Bloqueado' })).toBeDisabled()
  })

  it('el botón de peligro usa el color error', () => {
    conTema(<Button color="error" variant="contained">Eliminar</Button>)
    expect(screen.getByRole('button', { name: 'Eliminar' })).toHaveClass('MuiButton-colorError')
  })
})

describe('campo (normal / error / deshabilitado)', () => {
  it('muestra el mensaje de error asociado y marca inválido', () => {
    conTema(<TextField label="Nombre" error helperText="Obligatorio" />)
    expect(screen.getByLabelText('Nombre')).toBeInvalid()
    expect(screen.getByText('Obligatorio')).toBeInTheDocument()
  })

  it('deshabilitado no admite edición', () => {
    conTema(<TextField label="Código" disabled />)
    expect(screen.getByLabelText('Código')).toBeDisabled()
  })
})

describe('EtiquetaEstado', () => {
  it.each([
    ['neutral', 'MuiChip-outlined'],
    ['primario', 'MuiChip-colorPrimary'],
    ['exito', 'MuiChip-colorSuccess'],
    ['aviso', 'MuiChip-colorWarning'],
    ['error', 'MuiChip-colorError'],
    ['info', 'MuiChip-colorInfo'],
  ] as const)('variante %s', (variante, clase) => {
    conTema(<EtiquetaEstado texto="Estado" variante={variante} />)
    expect(screen.getByText('Estado').closest('.MuiChip-root')).toHaveClass(clase)
  })
})

describe('TarjetaBase', () => {
  it('muestra título y contenido', () => {
    conTema(<TarjetaBase titulo="Resumen">Contenido</TarjetaBase>)
    expect(screen.getByRole('heading', { name: 'Resumen' })).toBeInTheDocument()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })
})

describe('estados de página con el tema (cargando / vacío / error)', () => {
  it('conservan su comportamiento bajo el tema del panel', () => {
    const reintentar = vi.fn()
    conTema(<><EstadoCargaPagina /><EstadoVacio titulo="Sin datos" /><EstadoError reintentar={reintentar} /></>)
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.getByText('Sin datos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(reintentar).toHaveBeenCalledOnce()
  })
})
