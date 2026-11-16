import type { ResumenOpiniones } from '../../../lib/tiendaOpiniones'

const formatoPromedio = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const textoPuntuacion = (valor: number): string => `${valor} ${valor === 1 ? 'estrella' : 'estrellas'} de 5`

export const textoResumen = ({ promedio, cantidad }: ResumenOpiniones): string =>
  promedio === null ? 'Todavía no hay opiniones' : `${formatoPromedio.format(promedio)} de 5 · ${cantidad} ${cantidad === 1 ? 'opinión' : 'opiniones'}`

export const formatoFecha = (dia: string): string => {
  const [anio, mes, diaMes] = dia.split('-')
  return anio && mes && diaMes ? `${diaMes}/${mes}/${anio}` : dia
}
