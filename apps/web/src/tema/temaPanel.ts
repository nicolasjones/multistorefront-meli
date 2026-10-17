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

const alerta = (tono: { fondo: string; texto: string; icono: string }) => ({
  backgroundColor: tono.fondo,
  color: tono.texto,
  '& .MuiAlert-icon': { color: tono.icono },
})

// Tema del panel: extiende el tema base de MUI/Refine con los tokens.
export const temaPanel = createTheme({
  palette: {
    mode: 'light',
    primary: { main: color.accion, dark: color.accionHover },
    error: { main: color.peligro },
    success: { main: color.exito },
    warning: { main: color.aviso },
    info: { main: color.info },
    text: { primary: color.texto, secondary: color.textoSecundario, disabled: color.placeholder },
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
        root: { borderRadius: forma.radioEtiqueta, height: forma.altoEtiqueta },
        label: { fontWeight: tipografia.pesoEnfasis, fontSize: `${escala.etiqueta.tamano}px` },
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
    // Métricas (.cb): casilla alineada a la medida y los colores del prototipo (FR-005).
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: color.control.checkBorde,
          '&.Mui-checked': { color: color.control.checkActivo },
          '& .MuiSvgIcon-root': { fontSize: forma.ladoCheckbox },
        },
      },
    },
    // .sw: switch 40×22 con apagado/encendido del prototipo (FR-005).
    MuiSwitch: {
      styleOverrides: {
        root: { width: forma.anchoSwitch + 8, height: forma.altoSwitch + 8, padding: 4 },
        switchBase: { padding: 4, '&.Mui-checked': { transform: `translateX(${forma.anchoSwitch - forma.altoSwitch + 2}px)` } },
        thumb: { width: forma.altoSwitch - 4, height: forma.altoSwitch - 4, boxShadow: 'none' },
        track: {
          width: forma.anchoSwitch,
          height: forma.altoSwitch,
          borderRadius: forma.radioSwitch,
          backgroundColor: color.control.switchApagado,
          opacity: 1,
        },
      },
    },
    // Alertas con los tonos .al (FR-005).
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: forma.radioAlerta, padding: '12px 14px', alignItems: 'flex-start', gap: 10 },
        standardInfo: alerta(color.alerta.info),
        standardWarning: alerta(color.alerta.aviso),
        standardError: alerta(color.alerta.error),
        standardSuccess: alerta(color.alerta.exito),
      },
    },
    // .snack: aviso oscuro con esquinas del prototipo (FR-005).
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          backgroundColor: color.texto,
          color: color.superficie,
          borderRadius: forma.radioSnackbar,
          fontSize: `${escala.b.tamano}px`,
          fontWeight: 500,
        },
      },
    },
    // .menu: contorno, esquinas e ítem seleccionado del prototipo (FR-005).
    MuiMenu: {
      styleOverrides: {
        paper: {
          border: `1px solid ${color.bordeSuave}`,
          borderRadius: forma.radioMenu,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
          padding: 6,
        },
        list: { paddingTop: 0, paddingBottom: 0 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: forma.radioMenuItem,
          fontSize: `${escala.b.tamano}px`,
          padding: '9px 10px',
          '&.Mui-selected': { backgroundColor: color.fila.destacada },
          '&.Mui-selected:hover': { backgroundColor: color.fila.destacada },
        },
      },
    },
    // Tabs del prototipo: ítem 14/600, borde inferior suave, activo oscuro (FR-005).
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 0, gap: 4, borderBottom: `1px solid ${color.bordeSuave}` },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 0,
          padding: '10px 14px',
          fontSize: `${escala.b.tamano}px`,
          fontWeight: tipografia.pesoEnfasis,
          textTransform: 'none',
          color: color.textoSecundario,
          '&.Mui-selected': { color: color.texto },
        },
      },
    },
    // .bar: progreso 6/3 sobre fondo alterno (FR-005).
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: forma.altoBarra, borderRadius: forma.radioBarra, backgroundColor: color.fondoAlterno },
        bar: { borderRadius: forma.radioBarra },
      },
    },
    // .avatar: fondo/texto del prototipo (FR-005).
    MuiAvatar: {
      styleOverrides: {
        root: { backgroundColor: color.avatar.fondo, color: color.avatar.texto, fontWeight: 700 },
      },
    },
    // Sider oscuro del prototipo (FR-008). Solo los drawers anclados a la
    // izquierda (sider fijo en md+ y drawer mobile): el chat flotante usa la
    // derecha y no se ve afectado.
    MuiDrawer: {
      styleOverrides: {
        paperAnchorDockedLeft: {
          backgroundColor: color.sider.fondo,
          color: color.sider.itemTexto,
          borderRight: 'none',
          '& > .MuiPaper-root': {
            backgroundColor: color.sider.fondo,
            borderBottom: `1px solid ${color.sider.pieBorde}`,
            color: color.sider.itemTexto,
            '& .MuiTypography-root': { color: color.sider.itemTexto },
          },
        },
        paperAnchorLeft: { backgroundColor: color.sider.fondo, color: color.sider.itemTexto },
      },
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
