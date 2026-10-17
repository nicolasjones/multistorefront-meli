import type { SupabaseClient } from '@supabase/supabase-js'

// Imágenes del producto (F-CAT-05, FR-012). La base y el bucket repiten estas reglas
// (tope de 4, JPG/PNG/WebP, 2 MB, prefijo por organización): acá solo se avisa antes.
export const BUCKET_IMAGENES = 'productos-imagenes'
export const MAX_IMAGENES = 4
export const MAX_BYTES_IMAGEN = 2 * 1024 * 1024
export const SEGUNDOS_URL_FIRMADA = 300
export const AYUDA_IMAGENES = 'Hasta 4 imágenes JPG, PNG o WebP de hasta 2 MB. La primera es la principal.'

const EXTENSION_POR_TIPO: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const TIPOS_ACEPTADOS = Object.keys(EXTENSION_POR_TIPO).join(',')

export type ImagenExistente = {
  id: string
  posicion: number
  ruta: string
  // URL firmada de corta vida; nula si no se pudo firmar.
  url: string | null
}

export type CambiosImagenes = {
  nuevas: File[]
  eliminadas: string[]
}

export const SIN_CAMBIOS_IMAGENES: CambiosImagenes = { nuevas: [], eliminadas: [] }

export const hayCambiosImagenes = (cambios: CambiosImagenes) => cambios.nuevas.length > 0 || cambios.eliminadas.length > 0

// Mensaje de rechazo del archivo, o null si se puede agregar. `cantidadActual` cuenta
// las imágenes que quedarían (existentes no quitadas + nuevas ya elegidas).
export function validarArchivo(archivo: File, cantidadActual: number): string | null {
  if (!(archivo.type in EXTENSION_POR_TIPO)) {
    return `«${archivo.name}» no es JPG, PNG ni WebP.`
  }
  if (archivo.size > MAX_BYTES_IMAGEN) {
    return `«${archivo.name}» pesa más de 2 MB.`
  }
  if (cantidadActual >= MAX_IMAGENES) {
    return `Ya hay ${MAX_IMAGENES} imágenes: quitá alguna para agregar «${archivo.name}».`
  }
  return null
}

// Posiciones libres (1..4) en orden ascendente, para asignar a las nuevas.
export function posicionesLibres(ocupadas: readonly number[], cuantas: number): number[] {
  const libres: number[] = []
  for (let posicion = 1; posicion <= MAX_IMAGENES && libres.length < cuantas; posicion += 1) {
    if (!ocupadas.includes(posicion)) libres.push(posicion)
  }
  return libres
}

export type ImagenOrdenada =
  | { tipo: 'existente'; posicion: number; imagen: ImagenExistente }
  | { tipo: 'nueva'; posicion: number; archivo: File }

// Orden con el que quedarán las imágenes al guardar: la primera es la principal.
// Es la misma regla que usa `aplicarCambiosImagenes`, así lo que se ve es lo que se guarda.
export function ordenFinal(existentes: readonly ImagenExistente[], cambios: CambiosImagenes): ImagenOrdenada[] {
  const restantes = existentes.filter((imagen) => !cambios.eliminadas.includes(imagen.id))
  const libres = posicionesLibres(restantes.map((imagen) => imagen.posicion), cambios.nuevas.length)
  const lista: ImagenOrdenada[] = [
    ...restantes.map((imagen): ImagenOrdenada => ({ tipo: 'existente', posicion: imagen.posicion, imagen })),
    ...cambios.nuevas.slice(0, libres.length).map((archivo, indice): ImagenOrdenada => ({ tipo: 'nueva', posicion: libres[indice], archivo })),
  ]
  return lista.sort((a, b) => a.posicion - b.posicion)
}

export function rutaImagen(organizacionId: string, productoId: string, archivo: File): string {
  const extension = EXTENSION_POR_TIPO[archivo.type] ?? 'jpg'
  return `${organizacionId}/${productoId}/${crypto.randomUUID()}.${extension}`
}

export type ResultadoImagenes = {
  // Archivos que no se pudieron subir: se pueden reintentar tal cual.
  fallidas: File[]
  // Mensajes para mostrar, uno por archivo o imagen con problema.
  errores: string[]
}

type Cliente = Pick<SupabaseClient, 'schema' | 'storage'>

function mensajeDeImagen(error: unknown, porDefecto: string): string {
  const codigo = (error as { code?: string } | null)?.code
  if (codigo === '23514') return `${porDefecto} Revisá que sea JPG, PNG o WebP y que el producto no pase de ${MAX_IMAGENES} imágenes.`
  if (codigo === '42501') return 'Tu rol no puede modificar las imágenes de este producto.'
  if (codigo === '23505') return `${porDefecto} Alguien más cambió las imágenes: recargá el producto.`
  return porDefecto
}

// Aplica los cambios ya elegidos sobre un producto guardado: primero quita (libera
// posiciones) y después sube. Un fallo no corta el resto; se devuelve qué quedó pendiente.
export async function aplicarCambiosImagenes(
  cliente: Cliente,
  { organizacionId, productoId, existentes, cambios }: {
    organizacionId: string
    productoId: string
    existentes: readonly ImagenExistente[]
    cambios: CambiosImagenes
  },
): Promise<ResultadoImagenes> {
  const resultado: ResultadoImagenes = { fallidas: [], errores: [] }
  const tabla = () => cliente.schema('dominio').from('producto_imagenes')

  const noEliminadas = new Set<string>()
  for (const id of cambios.eliminadas) {
    const imagen = existentes.find((candidata) => candidata.id === id)
    if (!imagen) continue
    try {
      const { data, error } = await tabla().delete().eq('id', id).select('id')
      if (error || !data || data.length === 0) {
        console.error('No pudimos eliminar la imagen.', error)
        noEliminadas.add(id)
        resultado.errores.push(mensajeDeImagen(error, `No pudimos quitar la imagen ${imagen.posicion}.`))
        continue
      }
      // La fila ya no existe: si el archivo no se borra queda huérfano en el bucket privado.
      const { error: errorArchivo } = await cliente.storage.from(BUCKET_IMAGENES).remove([imagen.ruta])
      if (errorArchivo) {
        console.error('No pudimos borrar el archivo de la imagen eliminada.', errorArchivo)
        resultado.errores.push(`Se quitó la imagen ${imagen.posicion}, pero su archivo no se pudo borrar.`)
      }
    } catch (excepcion) {
      console.error('No pudimos eliminar la imagen.', excepcion)
      noEliminadas.add(id)
      resultado.errores.push(`No pudimos quitar la imagen ${imagen.posicion}.`)
    }
  }

  // Las filas que no se pudieron borrar siguen ocupando su posición.
  const restantes = existentes.filter((imagen) => !cambios.eliminadas.includes(imagen.id) || noEliminadas.has(imagen.id))
  const libres = posicionesLibres(restantes.map((imagen) => imagen.posicion), cambios.nuevas.length)
  for (const archivo of cambios.nuevas.slice(libres.length)) {
    resultado.fallidas.push(archivo)
    resultado.errores.push(`No hay lugar para «${archivo.name}»: el producto admite ${MAX_IMAGENES} imágenes.`)
  }

  for (const [indice, archivo] of cambios.nuevas.slice(0, libres.length).entries()) {
    try {
      const ruta = rutaImagen(organizacionId, productoId, archivo)
      const { error: errorSubida } = await cliente.storage.from(BUCKET_IMAGENES).upload(ruta, archivo, { contentType: archivo.type })
      if (errorSubida) {
        console.error('No pudimos subir la imagen.', errorSubida)
        resultado.fallidas.push(archivo)
        resultado.errores.push(`No pudimos subir «${archivo.name}».`)
        continue
      }
      const { error: errorFila } = await tabla().insert({
        producto_id: productoId,
        organizacion_id: organizacionId,
        posicion: libres[indice],
        ruta,
      })
      if (errorFila) {
        console.error('No pudimos registrar la imagen.', errorFila)
        const { error: errorLimpieza } = await cliente.storage.from(BUCKET_IMAGENES).remove([ruta])
        if (errorLimpieza) console.error('No pudimos limpiar el archivo sin registrar.', errorLimpieza)
        resultado.fallidas.push(archivo)
        resultado.errores.push(mensajeDeImagen(errorFila, `No pudimos guardar «${archivo.name}».`))
      }
    } catch (excepcion) {
      console.error('No pudimos subir la imagen.', excepcion)
      resultado.fallidas.push(archivo)
      resultado.errores.push(`No pudimos subir «${archivo.name}».`)
    }
  }
  return resultado
}

// Firma las rutas (bucket privado) y devuelve las imágenes con su URL temporal.
export async function firmarImagenes(
  cliente: Pick<SupabaseClient, 'storage'>,
  filas: ReadonlyArray<Omit<ImagenExistente, 'url'>>,
): Promise<ImagenExistente[]> {
  if (filas.length === 0) return []
  const { data, error } = await cliente.storage.from(BUCKET_IMAGENES).createSignedUrls(filas.map((fila) => fila.ruta), SEGUNDOS_URL_FIRMADA)
  if (error) {
    console.error('No pudimos firmar las imágenes del producto.', error)
  }
  return filas.map((fila) => ({
    ...fila,
    url: data?.find((firmada) => firmada.path === fila.ruta)?.signedUrl ?? null,
  }))
}

// Filas de imagen del producto tal como están ahora (sin URL firmada).
export async function leerImagenesProducto(cliente: Pick<SupabaseClient, 'schema'>, productoId: string): Promise<ImagenExistente[]> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('producto_imagenes')
    .select('id, posicion, ruta')
    .eq('producto_id', productoId)
    .order('posicion')
    .returns<Array<Omit<ImagenExistente, 'url'>>>()
  if (error) throw error
  return (data ?? []).map((fila) => ({ ...fila, url: null }))
}
