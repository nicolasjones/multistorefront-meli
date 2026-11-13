// Código de barras EAN-13 ficticio con dígito verificador válido (prefijo 779 = Argentina).
export function ean13(n) {
  const base = `779${String(n).padStart(9, '0')}`
  const suma = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0)
  return `${base}${(10 - (suma % 10)) % 10}`
}
