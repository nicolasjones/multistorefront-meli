import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Estados del RMA (F-VTA-28, MSF-288, FR-003). Manda el documento (comportamiento): abierto → en_gestion → cerrado; las
// etiquetas visibles son las del prototipo («Abierta», «Cerrada») más «En gestión» (Decisiones abiertas 3 de la spec).
// La autoridad de las transiciones es `cambiar_estado_rma` (F-VTA-29); acá solo se nombran y se calcula el próximo paso
// para ofrecer la acción.

export type EstadoRma = 'abierto' | 'en_gestion' | 'cerrado'

type DefinicionEstadoRma = { valor: EstadoRma; etiqueta: string; tono: VarianteEtiqueta }

export const ESTADOS_RMA: ReadonlyArray<DefinicionEstadoRma> = [
  { valor: 'abierto', etiqueta: 'Abierta', tono: 'aviso' },
  { valor: 'en_gestion', etiqueta: 'En gestión', tono: 'info' },
  { valor: 'cerrado', etiqueta: 'Cerrada', tono: 'exito' },
]

export const definicionEstadoRma = (estado: string): DefinicionEstadoRma =>
  ESTADOS_RMA.find((definicion) => definicion.valor === estado) ?? { valor: 'abierto', etiqueta: estado, tono: 'neutral' }

/** Próximo estado de la secuencia lineal (`abierto → en_gestion → cerrado`); `null` si ya está cerrado. */
export const siguienteEstadoRma = (estado: string): Exclude<EstadoRma, 'abierto'> | null =>
  estado === 'abierto' ? 'en_gestion' : estado === 'en_gestion' ? 'cerrado' : null
