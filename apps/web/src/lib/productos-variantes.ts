// Variantes de un producto (F-CAT-15, MSF-408, FR-001…FR-012). La autoridad es la base: la RPC
// `guardar_variantes_producto` (migración 20270125120400) exige edición en Productos, valida unicidad de código y
// código de barras (EAN-13), la regla de la primera variante y el bloqueo optimista; `v_producto_variantes` es el
// contrato de lectura (sin precio: la variante hereda el del producto). Acá solo se arman filas, payload y mensajes.
import type { SupabaseClient } from '@supabase/supabase-js'

export type FilaVariante = {
  // Clave local estable de la fila (el id real no existe hasta guardar).
  clave: string
  id: string | null
  nombre: string
  codigo: string
  codigoBarras: string
  activa: boolean
  // Unidades de la variante; null = sin acceso a Stock (no se muestra ni se envía).
  stock: number | null
}

export const TEXTO_SIN_VARIANTES = 'Si no cargás variantes, el producto se vende como una sola unidad.'
export const AVISO_VARIANTE_AGREGADA = 'Variante agregada: completá código y stock'
export const NOMBRE_VARIANTE_NUEVA = 'Nueva variante'

let contador = 0
export function claveNueva(): string {
  contador += 1
  return `nueva-${contador}`
}

// Fila de «Agregar variante»: «Nueva variante», código «<SKU>-<n>», sin código de barras, stock 0 y activa. `n`
// es la posición siguiente; si ese código ya está en la lista se sigue hasta uno libre.
export function varianteNueva(skuProducto: string, existentes: readonly FilaVariante[], conStock: boolean): FilaVariante {
  const base = skuProducto.trim() === '' ? 'VAR' : skuProducto.trim()
  const usados = new Set(existentes.map((fila) => fila.codigo.trim().toLowerCase()))
  let n = existentes.length + 1
  while (usados.has(`${base}-${n}`.toLowerCase())) n += 1
  return { clave: claveNueva(), id: null, nombre: NOMBRE_VARIANTE_NUEVA, codigo: `${base}-${n}`, codigoBarras: '', activa: true, stock: conStock ? 0 : null }
}

// Stock del producto con variantes = suma de las ACTIVAS (FR-005, FR-006). Null si no hay acceso a Stock.
export function stockTotalActivas(filas: readonly FilaVariante[]): number | null {
  if (filas.length === 0 || filas.every((fila) => fila.stock === null)) return null
  return filas.reduce((suma, fila) => suma + (fila.activa ? (fila.stock ?? 0) : 0), 0)
}

// Cambió la lista (las mismas variantes con los mismos valores en el mismo orden no cuentan).
export function variantesCambiaron(actual: readonly FilaVariante[], inicial: readonly FilaVariante[]): boolean {
  if (actual.length !== inicial.length) return true
  return actual.some((fila, i) => {
    const antes = inicial[i]
    return fila.id !== antes.id || fila.nombre.trim() !== antes.nombre.trim() || fila.codigo.trim() !== antes.codigo.trim()
      || fila.codigoBarras.trim() !== antes.codigoBarras.trim() || fila.activa !== antes.activa || fila.stock !== antes.stock
  })
}

type FilaVista = { id: string; nombre: string; codigo: string; codigo_barras: string | null; activa: boolean; stock: number | null }

// Variantes del producto en el orden guardado.
export async function leerVariantes(cliente: Pick<SupabaseClient, 'from'>, productoId: string): Promise<FilaVariante[]> {
  const { data, error } = await cliente
    .from('v_producto_variantes')
    .select('id, nombre, codigo, codigo_barras, activa, stock')
    .eq('producto_id', productoId)
    .order('orden', { ascending: true })
    .returns<FilaVista[]>()
  if (error) throw error
  return (data ?? []).map((fila) => ({
    clave: fila.id,
    id: fila.id,
    nombre: fila.nombre,
    codigo: fila.codigo,
    codigoBarras: fila.codigo_barras ?? '',
    activa: fila.activa,
    stock: fila.stock,
  }))
}

type ParametrosVariantes = { p_producto: string; p_actualizado_en: string | null; p_variantes: Array<Record<string, unknown>> }

// Payload de `guardar_variantes_producto` (`actualizadoEn` nulo = sin bloqueo optimista, solo para reintentar un alta): el orden del arreglo es el orden de las variantes. El stock solo viaja
// con edición en Stock (la base lo exige igual) y si la fila tiene valor.
export function parametrosGuardarVariantes(productoId: string, actualizadoEn: string | null, filas: readonly FilaVariante[], conStock: boolean): ParametrosVariantes {
  return {
    p_producto: productoId,
    p_actualizado_en: actualizadoEn,
    p_variantes: filas.map((fila) => ({
      ...(fila.id ? { id: fila.id } : {}),
      nombre: fila.nombre.trim(),
      codigo: fila.codigo.trim(),
      codigo_barras: fila.codigoBarras.trim() === '' ? null : fila.codigoBarras.trim(),
      activa: fila.activa,
      ...(conStock && fila.stock !== null ? { stock: fila.stock } : {}),
    })),
  }
}

export async function guardarVariantes(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string, actualizadoEn: string | null, filas: readonly FilaVariante[], conStock: boolean): Promise<void> {
  const { error } = await cliente.rpc('guardar_variantes_producto', parametrosGuardarVariantes(productoId, actualizadoEn, filas, conStock))
  if (error) throw error
}

// Error al guardar las variantes: las páginas lo lanzan para que el formulario lo distinga de un error del producto.
export class ErrorGuardarVariantes extends Error {
  readonly origen: unknown
  constructor(origen: unknown) {
    super('No pudimos guardar las variantes.')
    this.name = 'ErrorGuardarVariantes'
    this.origen = origen
  }
}

export type CampoVariante = 'nombre' | 'codigo' | 'codigo_barras' | 'stock'
export type ErrorVariante = { campo: CampoVariante; mensaje: string }

type ErrorRpc = { code?: string; message?: string; details?: string } | null | undefined

const CAMPOS: readonly CampoVariante[] = ['nombre', 'codigo', 'codigo_barras', 'stock']

// Campo al que apunta un error de la base: la RPC manda el campo en `details` (codigo, codigo_barras, nombre, stock).
export function campoDelError(error: unknown): CampoVariante | null {
  const detalle = (error as ErrorRpc)?.details
  return CAMPOS.find((campo) => campo === detalle) ?? null
}

// Fila a la que corresponde un error: el mensaje nombra entre comillas el código, el código de barras o (en stock)
// el nombre de la variante. Sin coincidencia queda como error general del bloque, no se adivina la fila.
export function erroresPorFila(error: unknown, filas: readonly FilaVariante[]): Record<string, ErrorVariante> {
  const e = error as ErrorRpc
  const campo = campoDelError(error)
  if (!campo || !e?.message) return {}
  const valor = /"([^"]+)"/.exec(e.message)?.[1]?.toLowerCase()
  const fila = valor
    ? filas.find((f) =>
        campo === 'codigo' ? f.codigo.trim().toLowerCase() === valor
          : campo === 'codigo_barras' ? f.codigoBarras.trim() === valor
            : f.nombre.trim().toLowerCase() === valor)
    : undefined
  return fila ? { [fila.clave]: { campo, mensaje: e.message } } : {}
}

// El mensaje crudo de Postgres no va al usuario salvo los que la RPC redacta para personas (22023 / 23505 llevan
// el valor que chocó); el detalle queda en consola.
export function mensajeErrorVariantes(error: unknown): string {
  console.error('No pudimos guardar las variantes.', error)
  const e = error as ErrorRpc
  if (e?.code === '40001') return 'El producto fue modificado por otra persona. Recargá la página para ver los cambios.'
  if (e?.code === '42501') return 'No tenés permiso para editar las variantes o su stock. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === 'P0002') return 'El producto ya no existe.'
  if ((e?.code === '23505' || e?.code === '22023') && e.message) return e.message
  return 'No pudimos guardar las variantes. Probá de nuevo.'
}
