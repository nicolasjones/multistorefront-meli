import { supabaseClient } from './supabase'

// Depósitos de mercadería (F-STK-14, MSF-316). El esquema y las reglas viven en las migraciones
// 20261023100000_depositos_tablas.sql, 20261023100100_depositos_gestion.sql y
// 20261023100400_stock_lecturas_deposito.sql; acá se espejan solo para validar y rotular
// (la autoridad es la base: RLS y las RPC de gestión, solo Administrador).

export type EmpresaDeposito = { id: string; nombre: string }

export type Deposito = {
  id: string
  nombre: string
  direccion: string | null
  activo: boolean
  por_defecto: boolean
  empresas: EmpresaDeposito[]
  empresa_ids: string[]
  productos_con_stock: number
  unidades: number
}

export const LARGO_MAXIMO_NOMBRE_DEPOSITO = 80
export const LARGO_MAXIMO_DIRECCION_DEPOSITO = 200

export type FormularioDeposito = {
  nombre: string
  direccion: string
  empresas: string[]
}

export type ErroresDeposito = Partial<Record<keyof FormularioDeposito, string>>

export function formularioDepositoVacio(deposito?: Deposito | null): FormularioDeposito {
  return {
    nombre: deposito?.nombre ?? '',
    direccion: deposito?.direccion ?? '',
    empresas: deposito?.empresa_ids ?? [],
  }
}

export function validarDeposito(formulario: FormularioDeposito): ErroresDeposito {
  const errores: ErroresDeposito = {}
  const nombre = formulario.nombre.trim()
  if (nombre === '') errores.nombre = 'Ingresá el nombre del depósito.'
  else if (nombre.length > LARGO_MAXIMO_NOMBRE_DEPOSITO) errores.nombre = `Máximo ${LARGO_MAXIMO_NOMBRE_DEPOSITO} caracteres.`
  if (formulario.direccion.trim().length > LARGO_MAXIMO_DIRECCION_DEPOSITO) {
    errores.direccion = `Máximo ${LARGO_MAXIMO_DIRECCION_DEPOSITO} caracteres.`
  }
  return errores
}

// Avisos de éxito (FR-002, FR-003; US1-1 y US1-4).
export const MENSAJE_DEPOSITO_CREADO = 'Depósito creado'
export const MENSAJE_DEPOSITO_GUARDADO = 'Depósito guardado'
export const avisoPorDefecto = (nombre: string) => `${nombre} es ahora el depósito por defecto`
export const avisoActivo = (nombre: string, activo: boolean) => `${nombre} quedó ${activo ? 'activo' : 'inactivo'}`

export const NOTA_DEPOSITO_CON_STOCK =
  'Un depósito con stock no se puede desactivar: trasladá antes la mercadería a otro depósito. El depósito por defecto tampoco.'

// Mensajes de rechazo que la base devuelve en castellano y son seguros de mostrar tal cual
// (migración 20261023100100). Cualquier otro texto crudo de Postgres va solo a consola.
const MENSAJES_DE_LA_BASE: ReadonlySet<string> = new Set([
  'Solo el Administrador puede definir depósitos',
  'Ya existe un depósito con ese nombre',
  'El nombre del depósito debe tener entre 1 y 80 caracteres',
  'La dirección admite hasta 200 caracteres',
  'Alguna de las empresas elegidas no es válida',
  'No encontramos ese depósito',
  'Activá el depósito antes de usarlo por defecto',
  'El depósito por defecto no se puede desactivar',
  'Tiene stock: trasladá la mercadería antes de desactivarlo',
])

export function mensajeDeErrorDeposito(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as { code?: string; message?: string } | null
  if (e?.message && MENSAJES_DE_LA_BASE.has(e.message)) return e.message
  if (e?.code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  return porDefecto
}

const COLUMNAS_LISTADO =
  'id, nombre, direccion, activo, por_defecto, empresas, empresa_ids, productos_con_stock, unidades'

// Depósitos de la organización; con `empresaId`, solo los que esa empresa puede vender («Venden desde acá»).
export async function listarDepositos(empresaId: string | null): Promise<Deposito[]> {
  let consulta = supabaseClient.from('depositos_listado').select(COLUMNAS_LISTADO)
  if (empresaId) consulta = consulta.contains('empresa_ids', [empresaId])
  const { data, error } = await consulta
    .order('por_defecto', { ascending: false })
    .order('nombre', { ascending: true })
    .returns<Deposito[]>()
  if (error) throw error
  // `unidades` y `productos_con_stock` llegan como bigint: PostgREST los serializa como número.
  return (data ?? []).map((fila) => ({
    ...fila,
    productos_con_stock: Number(fila.productos_con_stock),
    unidades: Number(fila.unidades),
  }))
}

export type DepositoOpcion = { id: string; nombre: string; por_defecto: boolean }

// Depósitos activos para los selectores (movimientos, traslados): el por defecto primero.
export async function listarDepositosActivos(): Promise<DepositoOpcion[]> {
  const { data, error } = await supabaseClient
    .from('depositos_listado')
    .select('id, nombre, por_defecto')
    .eq('activo', true)
    .order('por_defecto', { ascending: false })
    .order('nombre', { ascending: true })
    .returns<DepositoOpcion[]>()
  if (error) throw error
  return data ?? []
}

export async function crearDeposito(formulario: FormularioDeposito): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabaseClient
    .rpc('crear_deposito', {
      p_nombre: formulario.nombre.trim(),
      p_direccion: formulario.direccion.trim() === '' ? null : formulario.direccion.trim(),
      p_empresas: formulario.empresas,
    })
  if (error) throw error
  return data as unknown as { id: string; nombre: string }
}

export async function actualizarDeposito(id: string, formulario: FormularioDeposito): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabaseClient
    .rpc('actualizar_deposito', {
      p_deposito: id,
      p_nombre: formulario.nombre.trim(),
      p_direccion: formulario.direccion.trim() === '' ? null : formulario.direccion.trim(),
      p_empresas: formulario.empresas,
    })
  if (error) throw error
  return data as unknown as { id: string; nombre: string }
}

export async function definirDepositoPorDefecto(id: string): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabaseClient.rpc('definir_deposito_por_defecto', { p_deposito: id })
  if (error) throw error
  return data as unknown as { id: string; nombre: string }
}

export async function cambiarActivoDeposito(id: string, activo: boolean): Promise<{ id: string; nombre: string }> {
  const { data, error } = await supabaseClient.rpc('cambiar_activo_deposito', { p_deposito: id, p_activo: activo })
  if (error) throw error
  return data as unknown as { id: string; nombre: string }
}

export type StockPorDeposito = {
  deposito_id: string
  cantidad: number
  reservado: number
  disponible: number
}

type FilaStockPorDeposito = StockPorDeposito & { producto_id: string }

// Cantidad, reservado y disponible del producto en cada depósito (vista
// public.stock_por_deposito, security_invoker: rige la RLS de Stock). El diálogo
// de movimiento usa las cifras del depósito elegido (FR-010) y el listado las
// columnas del control de depósito (FR-011, D-4).
export async function listarStockPorDeposito(productoId: string): Promise<Record<string, StockPorDeposito>> {
  const { data, error } = await supabaseClient
    .from('stock_por_deposito')
    .select('producto_id, deposito_id, cantidad, reservado, disponible')
    .eq('producto_id', productoId)
    .returns<FilaStockPorDeposito[]>()
  if (error) throw error
  return Object.fromEntries(
    (data ?? []).map((fila) => [fila.deposito_id, {
      deposito_id: fila.deposito_id,
      cantidad: Number(fila.cantidad),
      reservado: Number(fila.reservado),
      disponible: Number(fila.disponible),
    }]),
  )
}

// Cifras de varios productos en un depósito, para el control de depósito del
// listado Stock actual (FR-011, D-4).
export async function listarStockPorDepositoDe(productoIds: string[], depositoId: string): Promise<Record<string, StockPorDeposito>> {
  if (productoIds.length === 0) return {}
  const { data, error } = await supabaseClient
    .from('stock_por_deposito')
    .select('producto_id, deposito_id, cantidad, reservado, disponible')
    .in('producto_id', productoIds)
    .eq('deposito_id', depositoId)
    .returns<FilaStockPorDeposito[]>()
  if (error) throw error
  return Object.fromEntries(
    (data ?? []).map((fila) => [fila.producto_id, {
      deposito_id: fila.deposito_id,
      cantidad: Number(fila.cantidad),
      reservado: Number(fila.reservado),
      disponible: Number(fila.disponible),
    }]),
  )
}
