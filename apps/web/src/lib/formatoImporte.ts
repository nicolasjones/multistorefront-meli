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
// `decimales` es un entero entre 0 y 10; fuera de ese rango lanza RangeError.
// La base acota el valor (`numeric(14,4)`), así que los enormes no ocurren; igual, como en `formatearImporte`,
// por encima de lo que un double escalado representa de forma exacta se muestra el entero por BigInt, sin decimales.
const MAX_DECIMALES_IMPORTE = 10

// `abs` por 10^decimales sin el error de coma flotante del producto; la notación científica de `String` se multiplica.
function escalarExacto(abs: number, decimales: number): number {
  const texto = String(abs)
  return texto.includes('e') ? abs * 10 ** decimales : Number(`${texto}e${decimales}`)
}

export function formatearImporteHasta(valor: number, decimales: number): string {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > MAX_DECIMALES_IMPORTE) {
    throw new RangeError(`decimales debe ser un entero entre 0 y ${MAX_DECIMALES_IMPORTE}`)
  }
  if (!Number.isFinite(valor)) return '—'
  const factor = 10 ** decimales
  const grande = Math.abs(valor) * factor > Number.MAX_SAFE_INTEGER
  // El redondeo parte de la representación decimal («1.00005e4» = 10000,5) y no de `valor * factor`
  // (1,00005 * 10⁴ da 10000,4999…): así los medios exactos suben, como en `formatearImporte`.
  const escalado = grande ? 1 : Math.round(escalarExacto(Math.abs(valor), decimales))
  const entero = grande ? BigInt(Math.round(Math.abs(valor))) : Math.floor(escalado / factor)
  const resto = grande ? '' : String(escalado % factor).padStart(decimales, '0').replace(/0+$/, '')
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
