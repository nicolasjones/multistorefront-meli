import { render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme, useTheme } from '@mui/material'
import { describe, expect, it } from 'vitest'
import { ProveedorTemaTienda } from './ProveedorTemaTienda'
import { IDENTIDADES_EJEMPLO, IDENTIDAD_TIENDA_POR_DEFECTO, crearTemaTienda } from './temaTienda'

function Sonda({ id }: { id: string }) {
  const t = useTheme()
  return <span data-testid={id}>{`${t.palette.primary.main}|${t.typography.fontFamily}|${t.typography.h1.fontFamily}`}</span>
}

describe('tema de tienda por empresa', () => {
  it('Mundo JC usa Barlow Condensed en títulos y Barlow en texto', () => {
    const t = crearTemaTienda(IDENTIDADES_EJEMPLO.mundoJc)
    expect(t.typography.h1.fontFamily).toContain('Barlow Condensed')
    expect(t.typography.fontFamily).toMatch(/^"Barlow"/)
  })

  it('dos tiendas con identidades distintas no mezclan estilos', () => {
    render(
      <>
        <ProveedorTemaTienda identidad={IDENTIDADES_EJEMPLO.mundoJc}><Sonda id="a" /></ProveedorTemaTienda>
        <ProveedorTemaTienda identidad={IDENTIDADES_EJEMPLO.sanJavucho}><Sonda id="b" /></ProveedorTemaTienda>
      </>,
    )
    const a = screen.getByTestId('a').textContent
    const b = screen.getByTestId('b').textContent
    expect(a).toContain('#C8102E')
    expect(a).toContain('Barlow')
    expect(b).toContain('#2E6B3F')
    expect(b).toContain('Playfair Display')
    expect(b).not.toContain('Barlow')
  })

  it('sin identidad usa el tema por defecto, y una parcial se completa', () => {
    expect(crearTemaTienda().palette.primary.main).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorPrimario)
    expect(crearTemaTienda(null).palette.primary.main).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorPrimario)
    const parcial = crearTemaTienda({ colorPrimario: '#123456' })
    expect(parcial.palette.primary.main).toBe('#123456')
    expect(parcial.palette.background.default).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorFondo)
  })

  it('valores null, undefined o inválidos caen al valor por defecto', () => {
    const t = crearTemaTienda({
      colorPrimario: null as unknown as string,
      colorFondo: 'red; } body { display:none',
      colorTexto: undefined,
      tipografiaTitulos: 'x"; } * { color:red',
      tipografiaTexto: '  Lato  ',
    })
    expect(t.palette.primary.main).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorPrimario)
    expect(t.palette.background.default).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorFondo)
    expect(t.palette.text.primary).toBe(IDENTIDAD_TIENDA_POR_DEFECTO.colorTexto)
    expect(t.typography.h1.fontFamily).toMatch(/^"system-ui"/)
    expect(t.typography.fontFamily).toMatch(/^"Lato"/)
  })

  it('el tema del panel queda intacto fuera de la tienda', () => {
    const panel = createTheme({ palette: { primary: { main: '#2B55E6' } }, typography: { fontFamily: 'Sora' } })
    render(
      <ThemeProvider theme={panel}>
        <Sonda id="panel-antes" />
        <ProveedorTemaTienda identidad={IDENTIDADES_EJEMPLO.mundoJc}><Sonda id="tienda" /></ProveedorTemaTienda>
        <Sonda id="panel-despues" />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('tienda').textContent).toContain('#C8102E')
    for (const id of ['panel-antes', 'panel-despues']) {
      expect(screen.getByTestId(id).textContent).toContain('#2B55E6')
      expect(screen.getByTestId(id).textContent).toContain('Sora')
    }
  })
})
