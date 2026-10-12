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
    peligro: '#C62828',
  },
  tipografia: {
    titulos: "'Sora Variable', Sora, system-ui, sans-serif",
    texto: "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif",
  },
  espaciado: 8,
  forma: {
    radioBoton: 9,
    altoBoton: 38,
  },
} as const

export type Tokens = typeof tokens
