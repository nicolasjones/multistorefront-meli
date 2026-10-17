// Tokens de diseño del panel (DS-01). Único lugar donde viven los valores
// de estilo; las pantallas los consumen vía el tema, no los repiten.
export const tokens = {
  color: {
    accion: '#2B55E6',
    accionHover: '#1E3FB8',
    texto: '#15181D',
    textoSecundario: '#5F6670',
    borde: '#D9D8D2',
    bordeSuave: '#E6E5E0',
    fondo: '#F5F5F2',
    fondoAlterno: '#EEEDE8',
    superficie: '#FFFFFF',
    peligro: '#C62828',
    exito: '#2E7D32',
    aviso: '#9A5B00',
    info: '#0277BD',
  },
  tipografia: {
    titulos: "'Sora Variable', Sora, system-ui, sans-serif",
    texto: "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif",
    pesoEnfasis: 600,
  },
  espaciado: 8,
  forma: {
    radioBoton: 9,
    radioBotonChico: 8,
    altoBoton: 38,
    altoBotonChico: 32,
    altoBotonGrande: 46,
    radioTarjeta: 12,
    radioEtiqueta: 6,
  },
} as const

export type Tokens = typeof tokens
