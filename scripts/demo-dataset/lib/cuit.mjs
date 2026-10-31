// CUIT/CUIL ficticios pero con dígito verificador válido (módulo 11), sin guiones.
const COEF = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
export function cuitValido(prefijo, numero) {
  let n = Number(numero)
  for (;;) {
    const base = `${prefijo}${String(n).padStart(8, '0')}`
    const suma = COEF.reduce((s, c, i) => s + c * Number(base[i]), 0)
    const resto = 11 - (suma % 11)
    const dv = resto === 11 ? 0 : resto
    if (resto !== 10) return `${base}${dv}`
    n += 1
  }
}
