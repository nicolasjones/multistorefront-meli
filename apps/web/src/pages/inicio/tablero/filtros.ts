import {
  ATAJOS_RANGO,
  rangoEsValido,
  rangoPorAtajo,
  type AtajoRango,
  type RangoFechas,
} from '../../../lib/ventas-reportes'

// Filtros del tablero de Inicio (F-INI-04, FR-001). Viven en la URL para poder compartir la vista:
//   ?periodo=hoy|siete-dias|este-mes|rango  (&desde=AAAA-MM-DD&hasta=AAAA-MM-DD si es rango)  &deposito=<uuid>  &tienda=<uuid>|todas
// Los tres filtros viajan en la URL para poder compartir la vista (historia MSF-820, CA-INI-04-7). Sin `tienda`
// el tablero sigue a la empresa activa de la barra superior (Principio VIII); con `tienda` manda la URL, y un
// cambio de la empresa activa en la barra superior la descarta (el cambio de arriba siempre gana).

export type ClavePeriodo = 'hoy' | 'siete-dias' | 'este-mes' | 'rango'

export const PERIODO_INICIAL: ClavePeriodo = 'este-mes'

// Los atajos de la historia (hoy, 7 días, mes) más el rango libre; «Mes anterior» no es de esta pantalla.
export const OPCIONES_PERIODO: ReadonlyArray<{ valor: ClavePeriodo; etiqueta: string }> = [
  ...ATAJOS_RANGO.filter((atajo) => atajo.valor !== 'mes-anterior').map((atajo) => ({ valor: atajo.valor as ClavePeriodo, etiqueta: atajo.etiqueta })),
  { valor: 'rango', etiqueta: 'Rango' },
]

export const TIENDA_TODAS = 'todas'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIAS_MAXIMOS = 366

export type FiltrosTablero = {
  periodo: ClavePeriodo
  rango: RangoFechas
  // Un rango libre inválido no se consulta: se avisa en el campo y se usa el último válido (o el mes en curso).
  errorRango: string | null
  depositoId: string | null
  // null = sin tienda en la URL (sigue a la empresa activa); 'todas' = todas las tiendas; si no, el id de la tienda.
  tienda: string | null
}

function diasEntre({ desde, hasta }: RangoFechas): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1
}

export function errorDeRango(rango: RangoFechas): string | null {
  if (rango.desde === '' || rango.hasta === '') return 'Indicá las dos fechas.'
  if (!rangoEsValido(rango)) return 'Hasta no puede ser anterior a Desde.'
  if (diasEntre(rango) > DIAS_MAXIMOS) return 'El período no puede superar 366 días.'
  return null
}

export function leerFiltros(params: URLSearchParams, ahora: Date = new Date()): FiltrosTablero {
  const pedido = params.get('periodo')
  const periodo = OPCIONES_PERIODO.some((opcion) => opcion.valor === pedido) ? (pedido as ClavePeriodo) : PERIODO_INICIAL
  const deposito = params.get('deposito')
  const depositoId = deposito !== null && UUID.test(deposito) ? deposito : null
  const pedidaTienda = params.get('tienda')
  const tienda = pedidaTienda === TIENDA_TODAS ? TIENDA_TODAS : pedidaTienda !== null && UUID.test(pedidaTienda) ? pedidaTienda : null
  if (periodo === 'rango') {
    const rango = { desde: params.get('desde') ?? '', hasta: params.get('hasta') ?? '' }
    const errorRango = errorDeRango(rango)
    if (errorRango === null) return { periodo, rango, errorRango, depositoId, tienda }
    return { periodo, rango: rangoPorAtajo('este-mes', ahora), errorRango, depositoId, tienda }
  }
  return { periodo, rango: rangoPorAtajo(periodo as AtajoRango, ahora), errorRango: null, depositoId, tienda }
}

// Parámetros de URL de un período (conserva `deposito` y `tienda`).
export function parametrosConPeriodo(actual: URLSearchParams, periodo: ClavePeriodo, rango?: RangoFechas): URLSearchParams {
  const nuevo = new URLSearchParams(actual)
  if (periodo === PERIODO_INICIAL) nuevo.delete('periodo')
  else nuevo.set('periodo', periodo)
  if (periodo === 'rango' && rango) {
    nuevo.set('desde', rango.desde)
    nuevo.set('hasta', rango.hasta)
  } else {
    nuevo.delete('desde')
    nuevo.delete('hasta')
  }
  return nuevo
}

export function parametrosConDeposito(actual: URLSearchParams, depositoId: string | null): URLSearchParams {
  const nuevo = new URLSearchParams(actual)
  if (depositoId === null) nuevo.delete('deposito')
  else nuevo.set('deposito', depositoId)
  return nuevo
}

// `tienda`: id de la tienda, 'todas' o null para volver a seguir a la empresa activa.
export function parametrosConTienda(actual: URLSearchParams, tienda: string | null): URLSearchParams {
  const nuevo = new URLSearchParams(actual)
  if (tienda === null) nuevo.delete('tienda')
  else nuevo.set('tienda', tienda)
  return nuevo
}

// Enlace a Reportes de ventas ya filtrado por el período (FR-005).
export function enlaceVentas(rango: RangoFechas): string {
  return `/ventas/reportes?desde=${rango.desde}&hasta=${rango.hasta}`
}
