// Formato argentino del ranking de clientes (F-CLI-08, FR-008): `$ 1.234.567` y `12,5 %`.

const formatoPesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const formatoPorcentaje = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const formatearPesos = (valor: number) => `$ ${formatoPesos.format(valor)}`
export const formatearParticipacion = (valor: number) => `${formatoPorcentaje.format(valor)} %`
