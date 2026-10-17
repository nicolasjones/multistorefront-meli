import { createTheme } from '@mui/material'
import { tokens } from './tokens'

const { color, tipografia, forma } = tokens
const { escala } = tipografia

const titulo = { fontFamily: tipografia.titulos }

type EstiloEscala = { tamano: number; peso: number; interlineado: number; espaciado: string }

const variante = (estilo: EstiloEscala, familia: string, tono?: string) => ({
  fontFamily: familia,
  fontSize: `${estilo.tamano}px`,
  fontWeight: estilo.peso,
  lineHeight: estilo.interlineado,
  letterSpacing: estilo.espaciado,
  ...(tono ? { color: tono } : {}),
})

// Escala del prototipo (.t1/.t2/.t3/.b/.bl/.s/.xs/.kpi) servida como variantes (FR-003).
const variantesEscala = {
  t1: variante(escala.t1, tipografia.titulos),
  t2: variante(escala.t2, tipografia.titulos),
  t3: variante(escala.t3, tipografia.titulos),
  kpi: variante(escala.kpi, tipografia.titulos),
  b: variante(escala.b, tipografia.texto),
  bl: variante(escala.bl, tipografia.texto),
  s: variante(escala.s, tipografia.texto, color.textoSecundario),
  xs: variante(escala.xs, tipografia.texto, color.textoSecundario),
}

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
    ...variantesEscala,
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: forma.altoBoton, borderRadius: forma.radioBoton },
        sizeSmall: { minHeight: forma.altoBotonChico, borderRadius: forma.radioBotonChico },
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
        root: { borderRadius: forma.radioEtiqueta, height: forma.altoEtiqueta },
        label: { fontWeight: tipografia.pesoEnfasis, fontSize: `${escala.etiqueta.tamano}px` },
      },
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
