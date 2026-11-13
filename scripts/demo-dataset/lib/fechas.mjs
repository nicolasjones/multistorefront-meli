// Fechas relativas a hoy: el dataset no envejece.
//
// La fecha es la del NEGOCIO (America/Argentina/Buenos_Aires, UTC-3 sin horario de verano desde 2009), no la de
// UTC: la base rechaza un ingreso en el futuro contra esa zona (`private.validar_reparacion`), así que entre las
// 21:00 y las 24:00 de Argentina calcular en UTC pondría «hoy» en el futuro y la siembra fallaría.
const DIA = 86_400_000
const OFFSET_HORAS = -3
const ahoraNegocio = () => new Date(Date.now() + OFFSET_HORAS * 3_600_000)
export const hoy = ahoraNegocio
export const haceDias = (n) => new Date(ahoraNegocio().getTime() - n * DIA)
export const iso = (d) => d.toISOString().slice(0, 10)
export const fechaHaceDias = (n) => iso(haceDias(n))
// Día hábil (lunes a sábado) más cercano hacia atrás: el negocio no factura los domingos.
export function diaHabilHaceDias(n) {
  let d = haceDias(n)
  while (d.getUTCDay() === 0) d = new Date(d.getTime() - DIA)
  return iso(d)
}
