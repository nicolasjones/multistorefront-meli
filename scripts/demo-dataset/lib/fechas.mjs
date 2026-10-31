// Fechas relativas a hoy: el dataset no envejece.
const DIA = 86_400_000
export const hoy = () => new Date()
export const haceDias = (n) => new Date(Date.now() - n * DIA)
export const iso = (d) => d.toISOString().slice(0, 10)
export const fechaHaceDias = (n) => iso(haceDias(n))
// Día hábil (lunes a sábado) más cercano hacia atrás: el negocio no factura los domingos.
export function diaHabilHaceDias(n) {
  let d = haceDias(n)
  while (d.getUTCDay() === 0) d = new Date(d.getTime() - DIA)
  return iso(d)
}
