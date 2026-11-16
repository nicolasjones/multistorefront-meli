import { supabaseClient } from './supabase'
import { esIdValido } from './tiendaListado'

// F-CLI-07 (MSF-432): precios de la tienda según el tipo del cliente con sesión. Qué escalas ve y a qué
// precio lo decide la base (migración 20261211110100_precios_cliente_por_dominio.sql): acá solo se pide y se
// acomoda la forma. FR-035: sin caché — cada carga hace su propia llamada y refleja el tipo y el estado
// actuales de la cuenta (la base los consulta en cada llamada).

export type EscalaPrecio = 'x1' | 'x5' | 'x10' | 'x50'

export type EscalaCliente = { escala: EscalaPrecio; desde: number; hasta: number | null; final: number | null }

export type PreciosCliente = { tipo: 'minorista' | 'mayorista'; escalas: EscalaCliente[] }

type FilaEscala = { escala: EscalaPrecio; desde: number; hasta: number | null; final: number | string | null }
type RespuestaPrecios = {
  tipo: 'minorista' | 'mayorista'
  precios: Array<{ producto_id: string; escalas: FilaEscala[] }>
}

// `null` = el visitante, o una cuenta suspendida / no habilitada / sin cuenta, ve el precio público de
// siempre. Sin sesión ni se llama a la base (publico.precios_cliente_por_dominio es solo `authenticated`).
// Si la llamada falla, también se cae al precio público (el precio extra no es imprescindible) y el error
// queda en consola.
export async function leerPreciosCliente(host: string, productoId: string): Promise<PreciosCliente | null> {
  if (!esIdValido(productoId)) return null
  const { data: sesion } = await supabaseClient.auth.getSession()
  if (!sesion.session) return null
  const { data, error } = await supabaseClient.schema('publico').rpc('precios_cliente_por_dominio', { host, productos: [productoId] })
  if (error) {
    console.error('No se pudieron cargar los precios del cliente', error.message)
    return null
  }
  if (!data) return null
  const respuesta = data as RespuestaPrecios
  const producto = respuesta.precios.find((p) => p.producto_id === productoId)
  if (!producto || producto.escalas.length === 0) return null
  return {
    tipo: respuesta.tipo,
    escalas: producto.escalas.map((e) => ({ ...e, final: e.final === null ? null : Number(e.final) })),
  }
}

export function rangoUnidades({ desde, hasta }: Pick<EscalaCliente, 'desde' | 'hasta'>): string {
  if (hasta === null) return `${desde} u. o más`
  if (hasta === desde) return `${desde} u.`
  return `${desde} a ${hasta} u.`
}
