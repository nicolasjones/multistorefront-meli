// Historial de campañas de correo masivo (F-CLI-13). Tipos del contrato de `listar_campanas_correo` y
// `detalle_campana_correo` (specs/20261028-100000-correo-masivo-a-clientes/contracts/correo-masivo.md) y textos.

export type EstadoCampana = 'en_curso' | 'completada'
export type EstadoDestinatario = 'pendiente' | 'enviado' | 'fallido' | 'omitido'

export type TotalesCampana = {
  destinatarios: number
  enviados: number
  fallidos: number
  omitidos: number
  pendientes: number
  bajas: number
}

export type CampanaHistorial = TotalesCampana & {
  id: string
  creada_en: string
  asunto: string
  autor: string
  estado: EstadoCampana
}

export type DetalleCampana = TotalesCampana & {
  id: string
  asunto: string
  mensaje: string
  estado: EstadoCampana
  creada_en: string
  autor: string
  empresa_id: string | null
}

export type DestinatarioCampana = {
  cliente_id: string
  nombre: string
  correo: string
  estado: EstadoDestinatario
  error: string | null
  baja: boolean
}

export const ETIQUETA_ESTADO_CAMPANA: Record<EstadoCampana, string> = { en_curso: 'En curso', completada: 'Completada' }
export const ETIQUETA_ESTADO_DESTINATARIO: Record<EstadoDestinatario, string> = {
  pendiente: 'Pendiente', enviado: 'Enviado', fallido: 'Fallido', omitido: 'Omitido',
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// «30/10/2026 14:05» (hora de Buenos Aires); una fecha ilegible se muestra vacía en vez de «Invalid Date».
export function textoFechaCampana(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : formatoFecha.format(fecha).replace(',', '')
}

// «3 de 10 enviados» para una campaña en curso: el progreso que se ve al recargar (escenario 3 de la US3).
export const textoProgreso = (t: Pick<TotalesCampana, 'destinatarios' | 'pendientes'>): string =>
  `${t.destinatarios - t.pendientes} de ${t.destinatarios} procesados`

export const RUTA_HISTORIAL_CORREO_MASIVO = '/clientes/correo-masivo/historial'
