import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Estados del RMA (F-VTA-28, MSF-288, FR-003). Manda el documento (comportamiento): abierto → en_gestion → cerrado; las
// etiquetas visibles son las del prototipo («Abierta», «Cerrada») más «En gestión» (Decisiones abiertas 3 de la spec).
// La autoridad de las transiciones es la base (F-VTA-29); acá solo se nombran.

export type EstadoRma = 'abierto' | 'en_gestion' | 'cerrado'

type DefinicionEstadoRma = { valor: EstadoRma; etiqueta: string; tono: VarianteEtiqueta }

export const ESTADOS_RMA: ReadonlyArray<DefinicionEstadoRma> = [
  { valor: 'abierto', etiqueta: 'Abierta', tono: 'aviso' },
  { valor: 'en_gestion', etiqueta: 'En gestión', tono: 'info' },
  { valor: 'cerrado', etiqueta: 'Cerrada', tono: 'exito' },
]

export const definicionEstadoRma = (estado: string): DefinicionEstadoRma =>
  ESTADOS_RMA.find((definicion) => definicion.valor === estado) ?? { valor: 'abierto', etiqueta: estado, tono: 'neutral' }
