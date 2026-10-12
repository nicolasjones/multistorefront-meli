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
    success: { main: color.exito },
    warning: { main: color.aviso },
    info: { main: color.info },
    text: { primary: color.texto, secondary: color.textoSecundario },
    divider: color.borde,
    background: { default: color.fondo, paper: color.superficie },
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
        sizeSmall: { minHeight: forma.altoBotonChico },
        sizeLarge: { minHeight: forma.altoBotonGrande },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: forma.radioBoton,
          backgroundColor: color.superficie,
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: color.textoSecundario },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: color.accion },
          '&.Mui-disabled': { backgroundColor: color.fondoAlterno },
        },
        notchedOutline: { borderColor: color.borde },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: forma.radioTarjeta, borderColor: color.bordeSuave },
      },
    },
    MuiChip: {
      styleOverrides: { label: { fontWeight: tipografia.pesoEnfasis } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: forma.radioBoton } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: color.bordeSuave },
        head: { backgroundColor: color.fondoAlterno, color: color.textoSecundario, fontWeight: tipografia.pesoEnfasis },
      },
    },
  },
})
