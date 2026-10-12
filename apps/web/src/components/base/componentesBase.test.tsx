import { Button, TextField, ThemeProvider } from '@mui/material'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { temaPanel } from '../../tema/temaPanel'
import { tokens } from '../../tema/tokens'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { EtiquetaEstado } from './EtiquetaEstado'
import { TarjetaBase } from './TarjetaBase'

const conTema = (ui: ReactNode) => render(<ThemeProvider theme={temaPanel}>{ui}</ThemeProvider>)

describe('tema: botones y campos', () => {
  it('define tamaños de botón y estilos de campo desde los tokens', () => {
    const botones = temaPanel.components?.MuiButton?.styleOverrides as Record<string, Record<string, unknown>>
    expect(botones.root.minHeight).toBe(tokens.forma.altoBoton)
    expect(botones.sizeSmall.minHeight).toBe(tokens.forma.altoBotonChico)
    expect(botones.sizeLarge.minHeight).toBe(tokens.forma.altoBotonGrande)
    expect(temaPanel.components?.MuiTextField?.defaultProps).toMatchObject({ size: 'small' })
  })
})

describe('tema: colores y estados interactivos desde los tokens', () => {
  it('hover del botón primario, foco del campo y fondo deshabilitado salen de los tokens', () => {
    // jsdom no simula :hover; se verifica la definición en el tema.
    expect(temaPanel.palette.primary.main).toBe(tokens.color.accion)
    expect(temaPanel.palette.primary.dark).toBe(tokens.color.accionHover)
    const campo = temaPanel.components?.MuiOutlinedInput?.styleOverrides?.root as Record<string, Record<string, unknown>>
    expect(campo['&.Mui-focused .MuiOutlinedInput-notchedOutline'].borderColor).toBe(tokens.color.accion)
    expect(campo['&.Mui-disabled'].backgroundColor).toBe(tokens.color.fondoAlterno)
  })

  it('la paleta semántica y el peso de énfasis no usan valores sueltos', () => {
    expect(temaPanel.palette.warning.main).toBe(tokens.color.aviso)
    expect(temaPanel.palette.background.paper).toBe(tokens.color.superficie)
    expect(temaPanel.components?.MuiChip?.styleOverrides?.label).toMatchObject({ fontWeight: tokens.tipografia.pesoEnfasis })
  })
})

describe('botón (normal / deshabilitado / foco / cargando)', () => {
  it('está habilitado por defecto, deshabilitado y recibe foco', () => {
    conTema(<><Button>Guardar</Button><Button disabled>Bloqueado</Button></>)
    const normal = screen.getByRole('button', { name: 'Guardar' })
    expect(normal).toBeEnabled()
    normal.focus()
    expect(normal).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Bloqueado' })).toBeDisabled()
  })

  it('cargando queda deshabilitado y conserva su texto', () => {
    conTema(<Button loading>Guardando</Button>)
    const cargando = screen.getByRole('button', { name: /Guardando/ })
    expect(cargando).toBeDisabled()
    expect(cargando).toHaveClass('MuiButton-loading')
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

  it('aplica el radio de etiqueta del token', () => {
    conTema(<EtiquetaEstado texto="Estado" />)
    const chip = screen.getByText('Estado').closest('.MuiChip-root')
    expect(chip).toHaveStyle({ borderRadius: `${tokens.forma.radioEtiqueta}px` })
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
