import { formatearFecha } from './formatoRanking'

// Formato argentino del historial (F-VTA-38): `$ 412.300` y, solo si el importe trae
// centavos, `$ 412.300,50` (siempre dos decimales: nunca `$ 412.300,5`). No se redondea un importe archivado.
const formatoEntero = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const formatoCentavos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatearImporteHistorial = (valor: number) =>
  `$ ${(Number.isInteger(valor) ? formatoEntero : formatoCentavos).format(valor)}`
export { formatearFecha }
