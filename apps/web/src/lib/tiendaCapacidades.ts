import { supabaseClient } from './supabase'

// F-CLI-20 (MSF-452, FR-014, D-27): lo que la tienda pública puede mostrar de la épica «compra y cuentas». La bandera
// `tienda_pedidos` vive en `public.banderas_plataforma`, que `anon` no puede leer: el front solo conoce un booleano por
// `publico.capacidades_tienda_por_dominio(host)`. El servidor impone la bandera en cada RPC; esto solo decide qué se dibuja.

export type CapacidadesTienda = { pedidos: boolean }

type RespuestaCapacidades = { estado?: string; pedidos?: boolean } | null

// Una sola llamada por host y carga de página: el resultado (o la promesa en vuelo) se comparte entre el encabezado, el
// menú, la ficha y las rutas. Si falla no se guarda, así el siguiente uso reintenta.
const porHost = new Map<string, Promise<CapacidadesTienda | null>>()

// `null` = host desconocido, empresa desactivada o tienda pausada (los tres idénticos para el servidor). Lanza si la
// llamada falla (red o error de la base): el llamador decide qué dibujar.
export function leerCapacidadesTienda(host: string): Promise<CapacidadesTienda | null> {
  const guardada = porHost.get(host)
  if (guardada) return guardada
  const pedido = (async () => {
    const { data, error } = await supabaseClient.schema('publico').rpc('capacidades_tienda_por_dominio', { host })
    if (error) throw new Error(error.message)
    const respuesta = data as RespuestaCapacidades
    if (!respuesta || respuesta.estado !== 'ok') return null
    return { pedidos: respuesta.pedidos === true }
  })()
  porHost.set(host, pedido)
  pedido.catch(() => {
    if (porHost.get(host) === pedido) porHost.delete(host)
  })
  return pedido
}

// Solo para los tests: olvida lo leído.
export function reiniciarCapacidadesTienda(): void {
  porHost.clear()
}
