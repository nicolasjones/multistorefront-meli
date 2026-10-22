import { formatearFecha } from './formatoRanking'

// Formato argentino del historial (F-VTA-38): `$ 412.300` y, solo si el importe trae
// centavos, `$ 412.300,50`. No se redondea un importe archivado.
const formatoImporte = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export const formatearImporteHistorial = (valor: number) => `$ ${formatoImporte.format(valor)}`
export { formatearFecha }
