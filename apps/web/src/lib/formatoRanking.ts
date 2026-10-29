// Formato argentino del ranking de clientes (F-CLI-08, FR-008): `$ 1.234.567` y `12,5 %`.

const formatoPesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const formatoPorcentaje = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const formatearPesos = (valor: number) => `$ ${formatoPesos.format(valor)}`
export const formatearParticipacion = (valor: number) => `${formatoPorcentaje.format(valor)} %`

// `2026-10-15` → `15/10/2026` sin pasar por `Date` (evita corrimientos de zona horaria).
export const formatearFecha = (iso: string) => {
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}
