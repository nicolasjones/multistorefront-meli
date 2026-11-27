// Paleta oscura del panel (RF-INI-04-7, MSF-849). Misma forma que `tokens.color`, así `crearTemaPanel` la usa sin ramas.
// Contraste (WCAG 2.1 AA) verificado numéricamente en coloresOscuros.test.ts: texto >= 4.5:1 y gráficos/bordes de control >= 3:1
// sobre `fondo`, `superficie` y `fondoAlterno`.
import { tokens } from './tokens'

type Cadenas<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Cadenas<T[K]> }
export type Paleta = Cadenas<typeof tokens.color>

export const coloresOscuros: Paleta = {
  ...tokens.color,
  accion: '#8FA8FF',
  accionHover: '#B3C3FF',
  texto: '#E8EAED',
  textoSecundario: '#A9AFB8',
  textoTerciario: '#C6CAD0',
  borde: '#6B7385',
  bordeSuave: '#2D323B',
  fondo: '#12151A',
  fondoAlterno: '#242932',
  superficie: '#1B1F26',
  backdrop: 'rgba(0, 0, 0, 0.65)',
  placeholder: '#9097A1',
  peligro: '#FF8A8A',
  exito: '#6FD08C',
  aviso: '#F2B24A',
  info: '#6DB8F0',
  etiqueta: {
    neutral: { fondo: '#2D323B', texto: '#D5D8DD' },
    primario: { fondo: '#26325E', texto: '#C4D0FF' },
    exito: { fondo: '#1C3A28', texto: '#A5E6BB' },
    aviso: { fondo: '#43310F', texto: '#F7CF8A' },
    error: { fondo: '#4A2024', texto: '#FFC2C2' },
    info: { fondo: '#16384F', texto: '#B3DDF9' },
    contorno: { fondo: '#1B1F26', texto: '#A9AFB8', borde: '#6B7385' },
  },
  alerta: {
    info: { fondo: '#16384F', texto: '#B3DDF9', icono: '#6DB8F0' },
    aviso: { fondo: '#43310F', texto: '#F7CF8A', icono: '#F2B24A' },
    error: { fondo: '#4A2024', texto: '#FFC2C2', icono: '#FF8A8A' },
    exito: { fondo: '#1C3A28', texto: '#A5E6BB', icono: '#6FD08C' },
  },
  fila: { negativa: '#2E1D20', destacada: '#222B45' },
  avatar: { fondo: '#26325E', texto: '#C4D0FF' },
  control: {
    checkBorde: '#8D949E',
    checkActivo: '#8FA8FF',
    switchApagado: '#5A6170',
    switchEncendido: '#8FA8FF',
    estrella: '#F2B24A',
    estrellaApagada: '#5A6170',
  },
}
