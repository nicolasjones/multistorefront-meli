// Textos del resumen semanal por correo en Mi organización (F-REP-08, MSF-265): sin React, probados aparte.

export type EstadoResumen = {
  activo: boolean
  proximo_envio: string
  ultima_semana_desde: string | null
  ultimo_estado: string | null
  destinatarios: number
}

const ZONA = 'America/Argentina/Buenos_Aires'

const ESTADO_ULTIMO: Record<string, string> = {
  enviado: 'se envió',
  fallido: 'no se pudo enviar (queda registrado)',
  pendiente: 'se está enviando',
  sin_destinatario: 'no había administradores con correo para recibirlo',
  pausado: 'estaba pausado',
  vencido: 'no llegó a enviarse a tiempo y se descartó',
}

export function textoProximoEnvio(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return fecha.toLocaleString('es-AR', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function textoUltimoResumen(estado: EstadoResumen): string {
  if (!estado.ultima_semana_desde || !estado.ultimo_estado) return 'Todavía no se envió ningún resumen.'
  const [anio, mes, dia] = estado.ultima_semana_desde.split('-').map(Number)
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'long' })
  return `Último resumen (semana del ${semana}): ${ESTADO_ULTIMO[estado.ultimo_estado] ?? estado.ultimo_estado}.`
}
