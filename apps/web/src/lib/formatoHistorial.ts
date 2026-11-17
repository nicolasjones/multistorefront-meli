import { formatearImporte } from './formatoImporte'
import { formatearFecha } from './formatoRanking'

// Formato argentino del historial (F-VTA-38): `$ 412.300` y, solo si el importe trae
// centavos, `$ 412.300,50` (siempre dos decimales: nunca `$ 412.300,5`). No se redondea un importe archivado.
export const formatearImporteHistorial = (valor: number) => formatearImporte(valor)
export { formatearFecha }
