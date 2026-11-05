import { supabaseClient } from './supabase'

// F-TDA-06 (MSF-216): borrador, vista previa y publicación de la tienda. Los cambios de Identidad visual,
// Contenido y Catálogo visible se guardan en un borrador que la tienda pública no ve; «Publicar» los aplica en
// una transacción y deja una versión. El resumen de cambios, la versión vigente y la vista previa los calcula la
// base (migración 20270203130100_tienda_borrador_publicacion.sql); acá solo se leen y se mandan los valores.

export type AreaBorrador = 'identidad' | 'contenido' | 'catalogo'

export const ETIQUETA_AREA: Readonly<Record<AreaBorrador, string>> = {
  identidad: 'Identidad visual',
  contenido: 'Contenido',
  catalogo: 'Catálogo visible',
}

export type DatosCatalogoBorrador = {
  categorias: Array<{ id: string; visible: boolean }>
  productos: Array<{ id: string; visible: boolean; destacado: boolean }>
}

export type CambiosBorrador = {
  total: number
  resumen: string
  detalle: Array<{ area: AreaBorrador; campos: string[] }>
}

export type VersionVigente = { numero: number; publicadaAt: string; publicadaPor: string | null }

export type BorradorTienda = {
  hayBorrador: boolean
  // Valor completo de cada área tal como lo guarda la base (columnas en snake_case); null = sin cambios.
  identidad: Record<string, string | null> | null
  contenido: Record<string, string> | null
  catalogo: DatosCatalogoBorrador | null
  cambios: CambiosBorrador
  versionVigente: VersionVigente | null
  enLinea: boolean
  dominio: string | null
}

type FilaBorrador = {
  hay_borrador: boolean
  identidad: Record<string, string | null> | null
  contenido: Record<string, string> | null
  catalogo: DatosCatalogoBorrador | null
  cambios: CambiosBorrador
  version_vigente: { numero: number; publicada_at: string; publicada_por: string | null } | null
  en_linea: boolean
  dominio: string | null
}

export async function obtenerBorrador(empresaId: string): Promise<BorradorTienda> {
  const { data, error } = await supabaseClient.rpc('obtener_borrador_tienda', { p_empresa: empresaId })
  if (error) throw new Error(error.message)
  const fila = data as FilaBorrador
  return {
    hayBorrador: fila.hay_borrador,
    identidad: fila.identidad,
    contenido: fila.contenido,
    catalogo: fila.catalogo,
    cambios: fila.cambios,
    versionVigente: fila.version_vigente
      ? { numero: fila.version_vigente.numero, publicadaAt: fila.version_vigente.publicada_at, publicadaPor: fila.version_vigente.publicada_por }
      : null,
    enLinea: fila.en_linea,
    dominio: fila.dominio,
  }
}

// Error de la RPC con el `hint` (campo que rechazó la base), si lo hay.
export class ErrorBorrador extends Error {
  campo: string | null
  constructor(mensaje: string, campo: string | null | undefined) {
    super(mensaje)
    this.name = 'ErrorBorrador'
    this.campo = campo ?? null
  }
}

// Guarda el valor COMPLETO de un área en el borrador. La base valida con las mismas reglas que antes.
export async function guardarBorrador(empresaId: string, area: AreaBorrador, datos: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_borrador_tienda', { p_empresa: empresaId, p_area: area, p_datos: datos })
  if (error) throw new ErrorBorrador(error.message, (error as { hint?: string | null }).hint)
}

export async function descartarBorrador(empresaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('descartar_borrador_tienda', { p_empresa: empresaId })
  if (error) throw new Error(error.message)
}

// Número de la versión creada; null si no había nada para publicar (idempotente).
export async function publicarTienda(empresaId: string): Promise<number | null> {
  const { data, error } = await supabaseClient.rpc('publicar_tienda', { p_empresa: empresaId })
  if (error) throw new Error(error.message)
  return (data as { version: number | null }).version
}

// De las rutas candidatas a borrar, las que ninguna referencia usa (publicada, borrador o versiones).
export async function rutasSinReferencia(empresaId: string, rutas: string[]): Promise<string[]> {
  const { data, error } = await supabaseClient.rpc('rutas_tienda_sin_referencia', { p_empresa: empresaId, p_rutas: rutas })
  if (error) throw new Error(error.message)
  return (data ?? []) as string[]
}

export type VistaPreviaTienda = {
  empresaNombre: string
  enLinea: boolean
  identidad: Record<string, string | null>
  contenido: Record<string, string>
  hayProductos: boolean
  categorias: Array<{ id: string; nombre: string; padreId: string | null; productos: number }>
  destacados: Array<{ id: string; nombre: string; precio: number | null; disponible: boolean; imagen: string | null; categoriaId: string | null }>
}

type FilaVistaPrevia = {
  empresa_nombre: string
  en_linea: boolean
  identidad: Record<string, string | null>
  contenido: Record<string, string>
  hay_productos: boolean
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
  destacados: Array<{ id: string; nombre: string; precio: number | string | null; disponible: boolean; imagen: string | null; categoria_id: string | null }>
}

export async function leerVistaPrevia(empresaId: string): Promise<VistaPreviaTienda> {
  const { data, error } = await supabaseClient.rpc('vista_previa_tienda', { p_empresa: empresaId })
  if (error) throw new Error(error.message)
  const fila = data as FilaVistaPrevia
  return {
    empresaNombre: fila.empresa_nombre,
    enLinea: fila.en_linea,
    identidad: fila.identidad,
    contenido: fila.contenido,
    hayProductos: fila.hay_productos,
    categorias: fila.categorias.map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id, productos: c.productos })),
    destacados: fila.destacados.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio === null ? null : Number(p.precio),
      disponible: p.disponible,
      imagen: p.imagen,
      categoriaId: p.categoria_id,
    })),
  }
}

// Fecha y hora de la versión: «dd/mm/aaaa hh:mm».
export function formatearFechaVersion(iso: string): string {
  const f = new Date(iso)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`
}

// «N cambios sin publicar: <resumen>.» (FR-053).
export function textoAvisoCambios(cambios: CambiosBorrador): string {
  const n = cambios.total
  return `${n} ${n === 1 ? 'cambio sin publicar' : 'cambios sin publicar'}: ${cambios.resumen}.`
}
