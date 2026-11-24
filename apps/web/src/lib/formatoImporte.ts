// Formateador único de importes en pesos (es-AR). Todas las pantallas muestran un importe igual: separador de miles con
// punto, coma decimal y, si trae centavos, SIEMPRE dos decimales («$ 64.200,50», nunca «$ 64.200,5»). Un importe entero se
// muestra sin decimales («$ 64.200»), salvo que se pida `centavos: 'siempre'` (comprobantes, gastos).
// El agrupado es a mano: Intl `es-AR` no agrupa los números de 4 dígitos («1500» en vez de «1.500»).

type OpcionesImporte = {
  /** `'siempre'` fuerza dos decimales aun en un importe entero. Por omisión, el entero no lleva decimales. */
  centavos?: 'siempre' | 'si-hay'
  /** Símbolo delante del número; por omisión `$`. */
  simbolo?: string
  /** Dónde va el menos de un importe negativo: antes del símbolo («-$ 5») o después («$ -5»). Por omisión, antes. */
  menos?: 'antes' | 'despues'
}

// Solo el número (sin símbolo): para columnas cuyo encabezado ya dice la moneda y para importes con otra moneda delante.
export function formatearNumeroImporte(valor: number, opciones: Pick<OpcionesImporte, 'centavos'> = {}): string {
  if (!Number.isFinite(valor)) return '—'
  return formatearImporte(valor, { ...opciones, simbolo: '' }).replace(/^-?\s/, (m) => m.replace(' ', ''))
}

// Importe con hasta `decimales` decimales (la cotización del dólar guarda 4): 1465,1234 → «$ 1.465,1234».
// Un entero no lleva decimales; una única décima conserva su cero («$ 1.465,50»), como `formatearImporte`.
export function formatearImporteHasta(valor: number, decimales: number): string {
  if (!Number.isFinite(valor)) return '—'
  const factor = 10 ** decimales
  const escalado = Math.round(Math.abs(valor) * factor)
  const entero = Math.floor(escalado / factor)
  const resto = String(escalado % factor).padStart(decimales, '0').replace(/0+$/, '')
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const signo = valor < 0 && escalado > 0 ? '-' : ''
  const conDecimales = resto === '' ? '' : `,${resto.length === 1 ? `${resto}0` : resto}`
  return `${signo}$ ${miles}${conDecimales}`
}

export function formatearImporte(valor: number, opciones: OpcionesImporte = {}): string {
  if (!Number.isFinite(valor)) return '—'
  const simbolo = opciones.simbolo ?? '$'
  // Se redondea primero a centavos: 1234,999 es 1.235 (entero), no «1.235,00»; y -0 se ve «$ 0».
  // Por encima de los enteros seguros (≈ 9×10¹³ pesos en centavos) todo double ya es un entero y `String(1e21)` daría notación
  // científica: se pasa por BigInt, que imprime los dígitos completos, y no hay centavos.
  const grande = Math.abs(valor) * 100 > Number.MAX_SAFE_INTEGER
  const centavosTotales = grande ? 1 : Math.round(Math.abs(valor) * 100)
  const entero = grande ? BigInt(Math.round(Math.abs(valor))) : Math.floor(centavosTotales / 100)
  const resto = grande ? 0 : centavosTotales % 100
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const signo = valor < 0 && centavosTotales > 0 ? '-' : ''
  const conCentavos = resto !== 0 || opciones.centavos === 'siempre'
  const cuerpo = `${miles}${conCentavos ? `,${String(resto).padStart(2, '0')}` : ''}`
  return opciones.menos === 'despues' ? `${simbolo} ${signo}${cuerpo}` : `${signo}${simbolo} ${cuerpo}`
}
