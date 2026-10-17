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
        root: { minHeight: forma.altoBoton, borderRadius: forma.radioBoton, fontWeight: tipografia.pesoEnfasis, gap: 8 },
        sizeSmall: { minHeight: forma.altoBotonChico, borderRadius: forma.radioBotonChico, fontSize: 13, paddingLeft: 12, paddingRight: 12 },
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
      styleOverrides: {
        label: { fontWeight: tipografia.pesoEnfasis },
        sizeSmall: { height: 24, fontSize: '0.8125rem' },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 32,
          paddingLeft: 14,
          paddingRight: 14,
          fontSize: 13,
          fontWeight: tipografia.pesoEnfasis,
          color: color.texto,
          borderColor: color.borde,
          textTransform: 'none',
          '&.Mui-selected': { backgroundColor: color.texto, color: color.superficie, borderColor: color.texto },
          '&.Mui-selected:hover': { backgroundColor: color.texto },
        },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: forma.radioBoton } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: color.bordeSuave, padding: '12px 16px', fontSize: 14 },
        head: {
          backgroundColor: 'transparent',
          color: color.textoSecundario,
          fontWeight: tipografia.pesoEnfasis,
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          padding: '10px 16px',
          whiteSpace: 'nowrap',
        },
      },
    },
  },
})
