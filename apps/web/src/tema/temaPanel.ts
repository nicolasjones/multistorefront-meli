import { createTheme } from '@mui/material'
import { tokens } from './tokens'

const { color, tipografia, forma } = tokens

const titulo = { fontFamily: tipografia.titulos }

// Tema del panel: extiende el tema base de MUI/Refine con los tokens.
export const temaPanel = createTheme({
  palette: {
    mode: 'light',
    primary: { main: color.accion, dark: color.accionHover },
    error: { main: color.peligro },
    text: { primary: color.texto, secondary: color.textoSecundario },
    divider: color.borde,
    background: { default: color.fondo, paper: '#FFFFFF' },
  },
  spacing: tokens.espaciado,
  shape: { borderRadius: forma.radioBoton },
  typography: {
    fontFamily: tipografia.texto,
    h1: titulo,
    h2: titulo,
    h3: titulo,
    h4: titulo,
    h5: titulo,
    h6: titulo,
    subtitle1: titulo,
    button: { textTransform: 'none' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: forma.altoBoton, borderRadius: forma.radioBoton },
      },
    },
  },
})
