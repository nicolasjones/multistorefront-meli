import { useEffect, useState } from 'react'
import { urlsImagenesProducto } from './imagenProducto'
import { esIdValido, type ProductoListado } from './tiendaListado'
import { supabaseClient } from './supabase'
import { limpiarTextoPublico } from './tiendaTextos'

// F-TDA-20 (MSF-263): productos relacionados de la ficha. Cuáles son (misma categoría, hasta 4, sin el
// actual, destacados primero), su precio y su disponibilidad los decide la base
// (migración 20270205110201_tienda_relacionados.sql); acá solo se lee y se firman las imágenes.

export type Relacionados = {
  productos: ProductoListado[]
  // Rutas de imagen → URL firmada (una sola llamada para todos los relacionados).
  imagenes: Record<string, string>
}

type FilaRelacionados = {
  productos: Array<{
    id: string
    nombre: string
    precio: number | string | null
    disponible: boolean
    imagen: string | null
    categoria_id: string | null
  }>
}

// publico.relacionados_por_dominio es ejecutable por anon. `null` (host desconocido, empresa desactivada o
// producto no visible) equivale a «sin relacionados»: la ficha ya decide por su cuenta si existe.
export async function leerRelacionados(host: string, productoId: string): Promise<Relacionados> {
  if (!esIdValido(productoId)) return { productos: [], imagenes: {} }
  const { data, error } = await supabaseClient.schema('publico').rpc('relacionados_por_dominio', { host, producto: productoId })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) return { productos: [], imagenes: {} }
  const productos = (data as FilaRelacionados).productos.map((p) => ({
    id: p.id,
    nombre: limpiarTextoPublico(p.nombre),
    precio: p.precio === null ? null : Number(p.precio),
    disponible: p.disponible,
    imagen: p.imagen,
    categoriaId: p.categoria_id,
    destacado: false,
  }))
  const imagenes = await urlsImagenesProducto(productos.flatMap((p) => (p.imagen ? [p.imagen] : [])))
  return { productos, imagenes }
}

export type EstadoRelacionados =
  | { fase: 'cargando' }
  | { fase: 'vacia' }
  | { fase: 'error' }
  | ({ fase: 'lista' } & Relacionados)

type Resultado = { clave: string; estado: Exclude<EstadoRelacionados, { fase: 'cargando' }> }

// Al cambiar de host o de producto no se muestran los relacionados del anterior: vuelve a «cargando».
export function useRelacionados(host: string, productoId: string): EstadoRelacionados {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, productoId])

  useEffect(() => {
    let cancelada = false
    leerRelacionados(host, productoId)
      .then((r) => {
        if (!cancelada) setResultado({ clave, estado: r.productos.length === 0 ? { fase: 'vacia' } : { fase: 'lista', ...r } })
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar los productos relacionados', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` resume host y producto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!resultado || resultado.clave !== clave) return { fase: 'cargando' }
  return resultado.estado
}
