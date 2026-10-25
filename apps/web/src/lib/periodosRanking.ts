// Períodos del ranking de clientes (F-CLI-08, FR-008): atajos y validación del
// rango. Las fechas son `YYYY-MM-DD` y el «hoy» se calcula en la zona de la
// organización (America/Argentina/Buenos_Aires), no en la del navegador. El
// servidor (`ranking_clientes`) vuelve a validar el mismo rango máximo.

export const ZONA_ORGANIZACION = 'America/Argentina/Buenos_Aires'
export const ANIOS_MAXIMOS_RANGO = 5

export type AtajoPeriodo = 'este-mes' | 'mes-anterior' | 'ultimos-90-dias' | 'anio-en-curso'

export const ATAJOS_PERIODO: ReadonlyArray<{ valor: AtajoPeriodo; etiqueta: string }> = [
  { valor: 'este-mes', etiqueta: 'Este mes' },
  { valor: 'mes-anterior', etiqueta: 'Mes anterior' },
  { valor: 'ultimos-90-dias', etiqueta: 'Últimos 90 días' },
  { valor: 'anio-en-curso', etiqueta: 'Año en curso' },
]

export type RangoFechas = { desde: string; hasta: string }

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const dosDigitos = (n: number) => String(n).padStart(2, '0')
const aIso = (fecha: Date) => `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}-${dosDigitos(fecha.getUTCDate())}`
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()

// Fecha ISO válida (rechaza 2026-02-31) o null.
function leerFecha(texto: string): Date | null {
  const partes = FECHA_ISO.exec(texto)
  if (!partes) return null
  const [, anio, mes, dia] = partes
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)))
  return aIso(fecha) === texto ? fecha : null
}

// Hoy en la zona de la organización, como `YYYY-MM-DD`.
export function hoyEnOrganizacion(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_ORGANIZACION, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}

export function rangoDeAtajo(atajo: AtajoPeriodo, ahora: Date = new Date()): RangoFechas {
  const hoy = hoyEnOrganizacion(ahora)
  const actual = leerFecha(hoy)!
  const anio = actual.getUTCFullYear()
  const mes = actual.getUTCMonth()
  switch (atajo) {
    case 'este-mes':
      return { desde: aIso(new Date(Date.UTC(anio, mes, 1))), hasta: hoy }
    case 'mes-anterior':
      return { desde: aIso(new Date(Date.UTC(anio, mes - 1, 1))), hasta: aIso(new Date(Date.UTC(anio, mes, 0))) }
    case 'ultimos-90-dias':
      return { desde: aIso(new Date(Date.UTC(anio, mes, actual.getUTCDate() - 89))), hasta: hoy }
    case 'anio-en-curso':
      return { desde: `${anio}-01-01`, hasta: hoy }
  }
}

export type ErroresRango = { desde?: string; hasta?: string }

// Suma años calendario como Postgres (`date + interval 'N years'`): el 29/02 pasa al 28/02.
function sumarAnios(fecha: Date, anios: number): Date {
  const anio = fecha.getUTCFullYear() + anios
  const mes = fecha.getUTCMonth()
  return new Date(Date.UTC(anio, mes, Math.min(fecha.getUTCDate(), diasDelMes(anio, mes))))
}

// Un error por campo (asociable con aria-describedby); vacío = rango válido.
export function validarRango({ desde, hasta }: RangoFechas): ErroresRango {
  const errores: ErroresRango = {}
  const inicio = leerFecha(desde)
  const fin = leerFecha(hasta)
  if (!inicio) errores.desde = desde.trim() === '' ? 'Indicá la fecha Desde.' : 'La fecha Desde no es válida.'
  if (!fin) errores.hasta = hasta.trim() === '' ? 'Indicá la fecha Hasta.' : 'La fecha Hasta no es válida.'
  if (inicio && fin) {
    if (inicio > fin) errores.hasta = 'Hasta no puede ser anterior a Desde.'
    else if (fin > sumarAnios(inicio, ANIOS_MAXIMOS_RANGO)) errores.hasta = `El rango máximo es de ${ANIOS_MAXIMOS_RANGO} años.`
  }
  return errores
}

export const rangoEsValido = (rango: RangoFechas) => Object.keys(validarRango(rango)).length === 0
