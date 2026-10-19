// Tokens de diseño del panel (DS-01 + paridad con el prototipo, FR-001..FR-004).
// Único lugar donde viven los valores de estilo; las pantallas los consumen
// vía el tema, no los repiten.
export const tokens = {
  color: {
    accion: '#2B55E6',
    accionHover: '#1E3FB8',
    texto: '#15181D',
    textoSecundario: '#5F6670',
    textoTerciario: '#3B4048',
    borde: '#D9D8D2',
    bordeSuave: '#E6E5E0',
    fondo: '#F5F5F2',
    fondoAlterno: '#EEEDE8',
    superficie: '#FFFFFF',
    // Velo de los diálogos del prototipo (rgba(21,24,29,.5)).
    backdrop: 'rgba(21, 24, 29, 0.5)',
    placeholder: '#8A9099',
    peligro: '#C62828',
    exito: '#2E7D32',
    aviso: '#9A5B00',
    info: '#0277BD',
    // Tonos de etiqueta (chip) del prototipo: .chip.n/.p/.ok/.w/.e/.i/.o (FR-002).
    etiqueta: {
      neutral: { fondo: '#EEEDE8', texto: '#3B4048' },
      primario: { fondo: '#E4EAFD', texto: '#1E3FB8' },
      exito: { fondo: '#E1F3E7', texto: '#146B35' },
      aviso: { fondo: '#FCECD0', texto: '#7A4B00' },
      error: { fondo: '#FBE2E2', texto: '#9B1C1C' },
      info: { fondo: '#E2EFFA', texto: '#0B4F82' },
      contorno: { fondo: '#FFFFFF', texto: '#5F6670', borde: '#D9D8D2' },
    },
    // Tonos de alerta del prototipo: .al.i/.w/.e/.ok (FR-002).
    alerta: {
      info: { fondo: '#E9F2FC', texto: '#0B4F82', icono: '#0B4F82' },
      aviso: { fondo: '#FCF1DC', texto: '#6E4300', icono: '#B36B00' },
      error: { fondo: '#FBE7E7', texto: '#8A1A1A', icono: '#C62828' },
      exito: { fondo: '#E3F3E8', texto: '#155E36', icono: '#1E7A45' },
    },
    // Filas de tabla: .neg / .hi (FR-002).
    fila: { negativa: '#FFF6F6', destacada: '#F3F6FE' },
    // Sider (AdminSider, FR-002).
    sider: {
      fondo: '#15181D',
      itemTexto: '#C9CCD2',
      itemTextoActivo: '#FFFFFF',
      itemFondoActivo: '#2B55E6',
      itemHover: '#232830',
      label: '#7C838D',
      rol: '#9AA0A9',
      pieBorde: '#2A2E36',
    },
    // Avatar (.avatar, FR-002).
    avatar: { fondo: '#DCE4FB', texto: '#1E3FB8' },
    // Controles (FR-002).
    control: {
      checkBorde: '#B9BCB6',
      checkActivo: '#2B55E6',
      switchApagado: '#C9CBC6',
      switchEncendido: '#2B55E6',
      estrella: '#E9A23B',
      estrellaApagada: '#C9CBC6',
    },
  },
  tipografia: {
    titulos: "'Sora Variable', Sora, system-ui, sans-serif",
    texto: "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif",
    pesoEnfasis: 600,
    // Escala del prototipo (.t1/.t2/.t3/.b/.bl/.s/.xs/.kpi/.chip) como variantes (FR-003).
    escala: {
      // Titular del panel de marca del ingreso (no es parte de la escala de pantalla).
      hero: { tamano: 38, peso: 600, interlineado: 1.1, espaciado: '-0.01em' },
      t1: { tamano: 26, peso: 600, interlineado: 1.2, espaciado: '-0.01em' },
      t2: { tamano: 18, peso: 600, interlineado: 1.3, espaciado: '-0.005em' },
      t3: { tamano: 15, peso: 600, interlineado: 1.4, espaciado: '0' },
      b: { tamano: 14, peso: 400, interlineado: 1.5, espaciado: '0' },
      bl: { tamano: 15, peso: 400, interlineado: 1.5, espaciado: '0' },
      s: { tamano: 13, peso: 400, interlineado: 1.45, espaciado: '0' },
      xs: { tamano: 12, peso: 400, interlineado: 1.4, espaciado: '0' },
      kpi: { tamano: 30, peso: 600, interlineado: 1.1, espaciado: '-0.02em' },
      etiqueta: { tamano: 12.5, peso: 600, interlineado: 1, espaciado: '0' },
    },
    // .num
    numeros: { tabular: 'tabular-nums' },
  },
  espaciado: 8,
  // Formas y dimensiones del prototipo (FR-004).
  forma: {
    radioBoton: 9,
    radioBotonChico: 8,
    altoBoton: 38,
    altoBotonChico: 32,
    altoBotonGrande: 46,
    radioTarjeta: 12,
    // Diálogos del prototipo: 14 px de radio y sombra alta.
    radioModal: 14,
    radioEtiqueta: 999,
    altoEtiqueta: 24,
    radioCampo: 9,
    altoCampo: 40,
    altoCampoArea: 80,
    anchoIconButton: 34,
    altoIconButton: 34,
    radioIconButton: 8,
    ladoCheckbox: 18,
    radioCheckbox: 5,
    anchoSwitch: 40,
    altoSwitch: 22,
    radioSwitch: 11,
    altoSegmentado: 34,
    radioSegmentado: 9,
    radioMenu: 10,
    radioMenuItem: 7,
    radioSnackbar: 10,
    radioAlerta: 10,
    altoBarra: 6,
    radioBarra: 3,
    ladoMiniatura: 40,
    radioMiniatura: 8,
    anchoSider: 232,
    altoHeader: 60,
  },
} as const

type Tokens = typeof tokens
