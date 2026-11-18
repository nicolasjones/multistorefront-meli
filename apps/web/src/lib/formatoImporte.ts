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

export function formatearImporte(valor: number, opciones: OpcionesImporte = {}): string {
  if (!Number.isFinite(valor)) return '—'
  const simbolo = opciones.simbolo ?? '$'
  // Se redondea primero a centavos: 1234,999 es 1.235 (entero), no «1.235,00»; y -0 se ve «$ 0».
  const centavosTotales = Math.round(Math.abs(valor) * 100)
  const entero = Math.floor(centavosTotales / 100)
  const resto = centavosTotales % 100
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const signo = valor < 0 && centavosTotales > 0 ? '-' : ''
  const conCentavos = resto !== 0 || opciones.centavos === 'siempre'
  const cuerpo = `${miles}${conCentavos ? `,${String(resto).padStart(2, '0')}` : ''}`
  return opciones.menos === 'despues' ? `${simbolo} ${signo}${cuerpo}` : `${signo}${simbolo} ${cuerpo}`
}
