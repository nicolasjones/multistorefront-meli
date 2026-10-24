import { useEffect, useState } from 'react'
import { urlsImagenesProducto } from './imagenProducto'
import type { ProductoListado } from './tiendaListado'
import { supabaseClient } from './supabase'

// F-TDA-10 (MSF-399): destacados de la home con el precio final de la empresa. La visibilidad efectiva,
// el tope de 8, el precio y la disponibilidad los resuelve la base
// (migración 20261202100000_tienda_destacados_publicos.sql); acá solo se lee.

export type InicioTienda = {
  // La tienda tiene al menos un producto efectivamente visible (distingue «Catálogo en preparación»).
  hayProductos: boolean
  destacados: ProductoListado[]
  // Rutas de imagen → URL firmada (una sola llamada para todos los destacados).
  imagenes: Record<string, string>
}

type FilaInicio = {
  hay_productos: boolean
  productos: Array<{
    id: string
    nombre: string
    precio: number | string | null
    disponible: boolean
    imagen: string | null
    categoria_id: string | null
  }>
}

const INICIO_VACIO: InicioTienda = { hayProductos: false, destacados: [], imagenes: {} }

// publico.destacados_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o empresa
// desactivada devuelven null: para el front es una tienda sin productos.
export async function leerInicioTienda(host: string): Promise<InicioTienda> {
  const { data, error } = await supabaseClient.schema('publico').rpc('destacados_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return INICIO_VACIO
  }
  const fila = data as FilaInicio
  const destacados = fila.productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precio: p.precio === null ? null : Number(p.precio),
    disponible: p.disponible,
    imagen: p.imagen,
    categoriaId: p.categoria_id,
    destacado: true,
  }))
  const imagenes = await urlsImagenesProducto(destacados.flatMap((p) => (p.imagen ? [p.imagen] : [])))
  return { hayProductos: fila.hay_productos, destacados, imagenes }
}

export type EstadoInicioTienda =
  | { fase: 'cargando' }
  | { fase: 'error'; reintentar: () => void }
  | ({ fase: 'lista' } & InicioTienda)

// Los tres bloques de la home (estado de preparación, categorías y destacados) necesitan este mismo
// dato: los pedidos simultáneos de un host comparten una sola llamada (se libera al terminar, así un
// reintento o una visita nueva vuelven a leer).
const enCurso = new Map<string, Promise<InicioTienda>>()

function leerCompartido(host: string): Promise<InicioTienda> {
  const existente = enCurso.get(host)
  if (existente) return existente
  const pedido = leerInicioTienda(host).finally(() => enCurso.delete(host))
  enCurso.set(host, pedido)
  return pedido
}

type Resultado = { host: string; intento: number } & ({ error: true } | { error: false; inicio: InicioTienda })

// Al cambiar de host no se muestran los destacados del anterior; un error queda en el bloque que lo usa
// y ofrece reintentar (FR-007).
export function useInicioTienda(host: string): EstadoInicioTienda {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  useEffect(() => {
    let cancelada = false
    leerCompartido(host)
      .then((inicio) => { if (!cancelada) setResultado({ host, intento, error: false, inicio }) })
      .catch((error: unknown) => {
        console.error('No se pudo cargar el inicio de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ host, intento, error: true })
      })
    return () => { cancelada = true }
  }, [host, intento])

  if (!resultado || resultado.host !== host || resultado.intento !== intento) return { fase: 'cargando' }
  if (resultado.error) return { fase: 'error', reintentar: () => setIntento((actual) => actual + 1) }
  return { fase: 'lista', ...resultado.inicio }
}
