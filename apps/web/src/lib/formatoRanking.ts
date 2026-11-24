// Formato argentino del ranking de clientes (F-CLI-08, FR-008): `$ 1.234.567` y `12,5 %`.

import { formatearImporte } from './formatoImporte'

const formatoPorcentaje = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })


// Pesos enteros (el ranking redondea al peso) con punto de miles también en cuatro dígitos; el menos va después del `$`.
export const formatearPesos = (valor: number) => formatearImporte(Math.round(valor), { menos: 'despues' })

// Importes de la cuenta corriente (F-CLI-19): un saldo de 1.210,50 no puede verse como «$ 1.211» ni uno de
// 0,40 como «$ 0». Con centavos muestra siempre dos decimales; sin centavos, el entero (`$ 220.000`).
// Se redondea primero a centavos: 1234,999 es 1.235 (entero), no «1.235,00», y -0 se ve «$ 0». Un valor que no es
// número finito se ve «—» en vez de «$ NaN».
export const formatearPesosConCentavos = (valor: number) => formatearImporte(valor, { menos: 'despues' })
export const formatearParticipacion = (valor: number) => `${formatoPorcentaje.format(valor)} %`

// `2026-10-15` → `15/10/2026` sin pasar por `Date` (evita corrimientos de zona horaria).
export const formatearFecha = (iso: string) => {
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}
