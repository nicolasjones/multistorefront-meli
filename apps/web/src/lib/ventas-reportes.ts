// Datos de la pantalla «Reportes de ventas» (F-VTA-22, épica MSF-338, FR-005) que no dependen de
// React: sección, ruta, textos, atajos de período y los parámetros de URL que preseleccionan los
// filtros nativos del tablero de Superset («Más vendidos»).

import type { SupabaseClient } from '@supabase/supabase-js'
import { hoyEnOrganizacion } from './periodosRanking'

export const SECCION_REPORTES = 'reportes'

// Título y subtítulo del prototipo (VentasReportes.dc.html): mandan los textos de FR-005.
export const TITULO_REPORTES = 'Reportes de ventas'
export const SUBTITULO_REPORTES = 'Más vendidos, avisos de «avisame cuando vuelva» y ranking de clientes por facturación.'

// Nombre con el que el importador registra el tablero (infra/superset/dashboards/ventas-reportes/reportes.json).
export const NOMBRE_REPORTE_MAS_VENDIDOS = 'Ventas · Más vendidos'

// Estado vacío del período sin ventas (SC-003).
export const MENSAJE_SIN_VENTAS = 'No hay ventas en ese período'

// Ayuda del filtro de empresa (Principio VIII: el filtro sigue a la empresa activa de la barra superior).
// Texto del prototipo (VentasReportes.dc.html).
export const TEXTO_AYUDA_EMPRESAS = 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

// Filtros nativos del tablero (infra/superset/dashboards/ventas-reportes/dashboards/Mas_vendidos_1.yaml).
export const FILTRO_RANGO_ID = 'NATIVE_FILTER-rango'
export const FILTRO_EMPRESA_ID = 'NATIVE_FILTER-empresa'
export const COLUMNA_EMPRESA = 'empresa_nombre'

export type AtajoRango = 'hoy' | 'siete-dias' | 'este-mes' | 'mes-anterior'

// Atajos de período del prototipo (Hoy, 7 días, Este mes, Mes anterior).
export const ATAJOS_RANGO: ReadonlyArray<{ valor: AtajoRango; etiqueta: string }> = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'siete-dias', etiqueta: '7 días' },
  { valor: 'este-mes', etiqueta: 'Este mes' },
  { valor: 'mes-anterior', etiqueta: 'Mes anterior' },
]

// Período con el que abre la pantalla: el mes en curso.
export const ATAJO_RANGO_INICIAL: AtajoRango = 'este-mes'

export type RangoFechas = { desde: string; hasta: string }

const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const dosDigitos = (n: number) => String(n).padStart(2, '0')
const aIso = (fecha: Date) => `${fecha.getUTCFullYear()}-${dosDigitos(fecha.getUTCMonth() + 1)}-${dosDigitos(fecha.getUTCDate())}`

// Fecha ISO real (rechaza 2026-02-31) o null.
function leerFecha(texto: string): Date | null {
  const partes = FECHA_ISO.exec(texto)
  if (!partes) return null
  const [, anio, mes, dia] = partes
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)))
  return aIso(fecha) === texto ? fecha : null
}

// Rango de fechas de cada atajo. El «hoy» sale de la zona de la organización (no la del navegador):
// se reusa `hoyEnOrganizacion` de `periodosRanking` para que el cálculo del día sea uno solo.
export function rangoPorAtajo(atajo: AtajoRango, ahora: Date = new Date()): RangoFechas {
  const hoy = hoyEnOrganizacion(ahora)
  const [anio, mesTexto, diaTexto] = hoy.split('-')
  const anioNumero = Number(anio)
  const mes = Number(mesTexto) - 1
  const dia = Number(diaTexto)
  switch (atajo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case 'siete-dias':
      return { desde: aIso(new Date(Date.UTC(anioNumero, mes, dia - 6))), hasta: hoy }
    case 'este-mes':
      return { desde: aIso(new Date(Date.UTC(anioNumero, mes, 1))), hasta: hoy }
    case 'mes-anterior':
      return {
        desde: aIso(new Date(Date.UTC(anioNumero, mes - 1, 1))),
        hasta: aIso(new Date(Date.UTC(anioNumero, mes, 0))),
      }
  }
}

// Rango válido: dos fechas ISO reales y «desde» no posterior a «hasta».
export function rangoEsValido({ desde, hasta }: RangoFechas): boolean {
  const inicio = leerFecha(desde)
  const fin = leerFecha(hasta)
  return inicio !== null && fin !== null && inicio <= fin
}

// Texto en rison: entre comillas simples, con `!` escapado como `!!` y `'` como `!'`. Los nombres de
// empresa vienen de la base, pero se escapan igual: el rison termina en la URL del tablero.
function textoRison(valor: string): string {
  return `'${valor.replace(/!/g, '!!').replace(/'/g, "!'")}'`
}

// Rango de fechas en el formato de Superset («desde : hasta»), el que espera el filtro nativo de período.
export function valorRangoNativo({ desde, hasta }: RangoFechas): string {
  return `${desde} : ${hasta}`
}

// Parámetros de URL del embebido (`dashboardUiConfig.urlParams`) que preseleccionan los filtros
// nativos del tablero: el de período (siempre) y el de empresa (cuando hay una elegida). Superset
// lee `native_filters` en rison: los ids de filtro y la columna son constantes y los valores salen
// del rango y del nombre de la empresa, así que no entra texto libre del cliente.
export function urlParamsReportes({ rango, empresa }: { rango: RangoFechas; empresa: string | null }): Record<string, string> {
  const rangoTexto = textoRison(valorRangoNativo(rango))
  const filtros = [
    `(${FILTRO_RANGO_ID}:(extraFormData:(time_range:${rangoTexto}),filterState:(label:${rangoTexto},value:${rangoTexto}),id:${FILTRO_RANGO_ID},ownState:()))`,
  ]
  if (empresa) {
    const valor = textoRison(empresa)
    filtros.push(
      `(${FILTRO_EMPRESA_ID}:(extraFormData:(filters:!((col:${COLUMNA_EMPRESA},op:IN,val:!(${valor}))))),filterState:(label:!(${valor}),value:!(${valor})),id:${FILTRO_EMPRESA_ID},ownState:()))`,
    )
  }
  return { native_filters: `(${filtros.join(',')})` }
}

// Conteo de comprobantes que cuentan como venta en el período (FR-005): lo usa la pantalla para
// mostrar el estado vacío «No hay ventas en ese período». La RPC aplica el mismo predicado que el
// tablero y el mismo alcance (organización y empresas accesibles del usuario).
export async function leerConteoVentas(
  cliente: SupabaseClient,
  { rango, empresaId }: { rango: RangoFechas; empresaId: string | null },
): Promise<number> {
  const { data, error } = await cliente.rpc('ventas_reportes_conteo', {
    p_desde: rango.desde,
    p_hasta: rango.hasta,
    p_empresa_id: empresaId,
  })
  if (error) throw error
  return Number(data ?? 0)
}
