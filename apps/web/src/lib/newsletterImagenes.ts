// Copias optimizadas de las imágenes de producto para el correo del newsletter (MSF-979). Se crean AL ENVIAR la campaña, desde el panel y con la sesión de
// quien envía: se baja la imagen principal de cada producto de la foto (bucket privado `productos-imagenes`, con la política de lectura que ya existe), se
// recodifica a WebP con el lado largo en 600 px como máximo (`optimizarImagen`, que además descarta los metadatos EXIF) y se sube a `newsletter-imagenes`, el
// bucket PÚBLICO dedicado de solo lectura. Al final se registra la copia en la base (`registrar_imagen_newsletter`), que valida la dirección pública.
// Degradación segura: si una imagen no se puede bajar, optimizar, subir o registrar, ese producto sale SIN imagen y el envío sigue; nunca lanza.
import type { SupabaseClient } from '@supabase/supabase-js'
import { optimizarImagen } from './optimizarImagen'
import { supabaseClient } from './supabase'

export const BUCKET_ORIGINALES = 'productos-imagenes'
export const BUCKET_COPIAS = 'newsletter-imagenes'
// Lado largo máximo de la copia (el correo la muestra a 96 px de ancho: 600 cubre pantallas de alta densidad sin pesar).
export const LADO_MAXIMO_COPIA_PX = 600
// El bucket rechaza archivos mayores (262144 bytes): se comprueba antes de subir.
export const MAX_BYTES_COPIA = 256 * 1024
export const TIPO_COPIA = 'image/webp'

export type ProductoParaCopiar = { producto_id: string; organizacion_id: string; imagen_id: string; origen: string }
export type ResultadoCopias = { copiadas: number; omitidas: number }

type RespuestaRpc = { data: unknown; error: unknown }
export type DependenciasCopias = {
  rpc: (nombre: string, parametros: Record<string, unknown>) => Promise<RespuestaRpc>
  descargar: (bucket: string, ruta: string) => Promise<Blob | null>
  subir: (bucket: string, ruta: string, archivo: File) => Promise<boolean>
  urlPublica: (bucket: string, ruta: string) => string
  optimizar: (archivo: File, lado: number) => Promise<File>
}

export function dependenciasReales(cliente: Pick<SupabaseClient, 'storage'> = supabaseClient): Omit<DependenciasCopias, 'rpc'> {
  return {
    descargar: async (bucket, ruta) => {
      const { data, error } = await cliente.storage.from(bucket).download(ruta)
      return error ? null : data
    },
    subir: async (bucket, ruta, archivo) => {
      const { error } = await cliente.storage.from(bucket).upload(ruta, archivo, { upsert: true, contentType: TIPO_COPIA, cacheControl: '3600' })
      return !error
    },
    urlPublica: (bucket, ruta) => cliente.storage.from(bucket).getPublicUrl(ruta).data.publicUrl,
    optimizar: optimizarImagen,
  }
}

const esProducto = (valor: unknown): valor is ProductoParaCopiar => {
  const v = valor as Partial<Record<keyof ProductoParaCopiar, unknown>> | null
  return Boolean(v) && typeof v?.producto_id === 'string' && typeof v.organizacion_id === 'string' && typeof v.imagen_id === 'string' && typeof v.origen === 'string'
}

async function copiarUno(empresa: string, producto: ProductoParaCopiar, deps: DependenciasCopias): Promise<boolean> {
  const original = await deps.descargar(BUCKET_ORIGINALES, producto.origen)
  if (!original) return false
  const nombre = producto.origen.split('/').pop() || 'imagen'
  const optimizada = await deps.optimizar(new File([original], nombre, { type: original.type }), LADO_MAXIMO_COPIA_PX)
  // `optimizarImagen` devuelve el original si no pudo recodificar: solo sirve un WebP que entre en el tope del bucket.
  if (optimizada.type !== TIPO_COPIA || optimizada.size > MAX_BYTES_COPIA) return false
  const ruta = `${producto.organizacion_id}/${empresa}/${producto.producto_id}.webp`
  if (!(await deps.subir(BUCKET_COPIAS, ruta, optimizada))) return false
  const { error } = await deps.rpc('registrar_imagen_newsletter', {
    p_empresa: empresa, p_producto: producto.producto_id, p_imagen: producto.imagen_id, p_url: deps.urlPublica(BUCKET_COPIAS, ruta),
  })
  return !error
}

export async function prepararImagenesNewsletter(
  entrada: { empresa: string; destacados: boolean; promociones: boolean },
  deps: Pick<DependenciasCopias, 'rpc'> & Partial<Omit<DependenciasCopias, 'rpc'>>,
): Promise<ResultadoCopias> {
  const completas: DependenciasCopias = { ...dependenciasReales(), ...deps }
  const resultado: ResultadoCopias = { copiadas: 0, omitidas: 0 }
  if (!entrada.destacados && !entrada.promociones) return resultado
  try {
    const { data, error } = await completas.rpc('productos_para_imagenes_newsletter', {
      p_empresa: entrada.empresa, p_destacados: entrada.destacados, p_promociones: entrada.promociones,
    })
    if (error || !Array.isArray(data)) return resultado
    // De a uno: son a lo sumo 12 productos y así no se saturan ni la red ni el navegador.
    for (const producto of data) {
      if (!esProducto(producto)) { resultado.omitidas += 1; continue }
      let hecho = false
      try { hecho = await copiarUno(entrada.empresa, producto, completas) } catch { hecho = false }
      if (hecho) resultado.copiadas += 1
      else resultado.omitidas += 1
    }
  } catch {
    // Sin las copias el correo sale sin imágenes: nunca se bloquea el envío.
  }
  return resultado
}
