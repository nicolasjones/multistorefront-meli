// Historial de actividad (F-AUD-01, MSF-463): tipos, períodos y formato de
// fecha. Las fechas se calculan y muestran en America/Argentina/Buenos_Aires,
// nunca en UTC ni en la zona del navegador (FR-004).
export const ZONA_HORARIA_ACTIVIDAD = 'America/Argentina/Buenos_Aires'
export const TAMANO_PAGINA_ACTIVIDAD = 10

export type EventoActividadListado = {
  id: string
  creadoEn: string
  tipo: string
  empresaId: string | null
  empresaNombre: string | null
  actorId: string | null
  actorNombre: string | null
  detalle: string
}

export type PeriodoActividad = 'hoy' | '7dias' | '30dias' | 'todo'

export const ETIQUETA_PERIODO: Readonly<Record<PeriodoActividad, string>> = {
  hoy: 'Hoy',
  '7dias': 'Últimos 7 días',
  '30dias': 'Últimos 30 días',
  todo: 'Todo el historial',
}

export type FiltrosActividad = {
  periodo: PeriodoActividad
  empresa: string | null
  actor: string | null
  tipo: string | null
  texto: string
}

export const FILTROS_ACTIVIDAD_INICIALES: FiltrosActividad = {
  periodo: '7dias',
  empresa: null,
  actor: null,
  tipo: null,
  texto: '',
}

// Etiqueta visible de cada tipo conocido (entidad.accion). Un tipo que aún no
// figure acá (lo agrega otro componente) se muestra legible igual.
export const ETIQUETA_TIPO_ACTIVIDAD: Readonly<Record<string, string>> = {
  'empresa.actualizada': 'Empresa actualizada',
  'empresa.pausada': 'Empresa pausada',
  'empresa.reactivada': 'Empresa reactivada',
  'usuario.agregado': 'Usuario agregado',
  'usuario.rol_cambiado': 'Cambio de rol',
  'usuario.removido': 'Usuario removido',
  'usuario.empresa_activa_cambiada': 'Cambio de empresa activa',
  'usuario.empresas_asignadas': 'Empresas asignadas',
  'usuario.suspendido': 'Usuario suspendido',
  'usuario.reactivado': 'Usuario reactivado',
  'invitacion.enviada': 'Invitación enviada',
  'invitacion.reenviada': 'Invitación reenviada',
  'invitacion.cancelada': 'Invitación cancelada',
  'permisos.matriz_guardada': 'Permisos modificados',
  'permisos.matriz_restablecida': 'Permisos restablecidos',
  'cliente.creado': 'Cliente creado',
  'cliente.editado': 'Cliente editado',
  'cliente.archivado': 'Cliente archivado',
  'cliente.restaurado': 'Cliente restaurado',
  'comprobante.nota_credito_emitida': 'Comprobante nota crédito emitida',
  'rma.nota_credito_vinculada': 'RMA nota crédito vinculada',
  'reparacion.editada': 'Reparación editada',
}

// Palabras del tipo que llevan tilde o mayúsculas propias cuando no hay etiqueta explícita.
const PALABRA_ACTIVIDAD: Readonly<Record<string, string>> = { reparacion: 'reparación', credito: 'crédito', rma: 'RMA' }

export function etiquetaTipoActividad(tipo: string): string {
  const conocida = ETIQUETA_TIPO_ACTIVIDAD[tipo]
  if (conocida) return conocida
  const [entidad, accion] = tipo.split('.')
  const texto = `${entidad ?? ''} ${(accion ?? '').replace(/_/g, ' ')}`
    .trim()
    .split(' ')
    .map((palabra) => PALABRA_ACTIVIDAD[palabra] ?? palabra)
    .join(' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA_ACTIVIDAD,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Fecha calendario (YYYY-MM-DD) de un instante en hora de Buenos Aires.
export function diaEnBuenosAires(instante: Date): string {
  return formatoDia.format(instante)
}

function restarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

// Rango inclusivo de días que se pasa a listar_actividad. «Hoy» es el día de
// Buenos Aires aunque en UTC ya sea otro; «Últimos N días» incluye hoy.
export function rangoDelPeriodo(periodo: PeriodoActividad, ahora: Date = new Date()): { desde: string | null; hasta: string | null } {
  if (periodo === 'todo') return { desde: null, hasta: null }
  const hoy = diaEnBuenosAires(ahora)
  const dias = periodo === 'hoy' ? 0 : periodo === '7dias' ? 6 : 29
  return { desde: restarDias(hoy, dias), hasta: hoy }
}

const formatoCuando = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA_ACTIVIDAD,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// «dd/mm/aaaa hh:mm» en hora de Buenos Aires.
export function formatearCuando(iso: string): string {
  const partes = Object.fromEntries(formatoCuando.formatToParts(new Date(iso)).map((parte) => [parte.type, parte.value]))
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`
}
