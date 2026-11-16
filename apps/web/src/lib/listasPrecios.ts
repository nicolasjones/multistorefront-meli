import type { SupabaseClient } from '@supabase/supabase-js'

// Listas de precios (F-PRE-14 y F-CLI-21, Fases 1 y 2). Una lista es un porcentaje de ajuste sobre el precio central.
// La autoridad es la base (migraciones 20270340000000 y 20270340000200): las RPC `guardar_lista_precios`,
// `archivar_lista_precios`, `restaurar_lista_precios` y `asignar_lista_precios_cliente` validan rol, bandera y datos.
// Acá solo se lee, se valida lo mínimo para avisar antes de enviar y se traducen los errores. Esta fase NO calcula
// precios: no hay fórmula de precio en la web.

export type EstadoListas = 'activas' | 'archivadas' | 'todas'

export const ETIQUETA_ESTADO_LISTAS: Record<EstadoListas, string> = {
  activas: 'Activas',
  archivadas: 'Archivadas',
  todas: 'Todas',
}

export type ListaPrecios = {
  id: string
  nombre: string
  descripcion: string | null
  // Porcentaje con signo sobre el precio central, de -90 a +100 con 2 decimales.
  ajustePct: number
  archivadaEn: string | null
  clientesAsignados: number
  // Texto exacto que devolvió la base: es el control de concurrencia (JavaScript pierde los microsegundos).
  actualizadoEn: string
}

type FilaResumen = {
  id: string
  nombre: string
  descripcion: string | null
  ajuste_pct: number | string
  archivada_en: string | null
  updated_at: string
  clientes_asignados: number | string
}

const COLUMNAS = 'id, nombre, descripcion, ajuste_pct, archivada_en, updated_at, clientes_asignados'

const AJUSTE_MINIMO = -90
const AJUSTE_MAXIMO = 100
export const LARGO_NOMBRE = 80
export const LARGO_DESCRIPCION = 300

export const MOTIVO_LISTAS_APAGADAS = 'Las listas de precios están desactivadas en este entorno.'
export const NOTA_LISTA_REEMPLAZA_AJUSTE =
  'La lista parte del precio central y reemplaza el ajuste de la tienda: no se suman. El IVA se aplica después, como siempre.'

function mapearLista(fila: FilaResumen): ListaPrecios {
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    ajustePct: Number(fila.ajuste_pct),
    archivadaEn: fila.archivada_en,
    clientesAsignados: Number(fila.clientes_asignados),
    actualizadoEn: fila.updated_at,
  }
}

type TandaListas = { listas: ListaPrecios[]; total: number }

// Una tanda del listado, ordenada por nombre. El filtro de estado y el recorte viajan al servidor (Principio VI).
export async function leerListasPrecios(
  cliente: SupabaseClient,
  { estado, pagina, tamano }: { estado: EstadoListas; pagina: number; tamano: number },
): Promise<TandaListas> {
  let consulta = cliente.from('listas_precios_resumen').select(COLUMNAS, { count: 'exact' })
  if (estado === 'activas') consulta = consulta.is('archivada_en', null)
  if (estado === 'archivadas') consulta = consulta.not('archivada_en', 'is', null)
  const desde = (pagina - 1) * tamano
  const { data, error, count } = await consulta
    .order('nombre', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, desde + tamano - 1)
    .returns<FilaResumen[]>()
  if (error) throw error
  const filas = data ?? []
  return { listas: filas.map(mapearLista), total: count ?? filas.length }
}

// PostgREST recorta cada respuesta a `max_rows` (1000): se pide por tandas menores a ese tope hasta que una vuelve corta.
const TANDA_ACTIVAS = 500

// Listas activas para el selector de la ficha del cliente.
export async function leerListasActivas(cliente: SupabaseClient): Promise<ListaPrecios[]> {
  const listas: ListaPrecios[] = []
  for (let pagina = 1; ; pagina += 1) {
    const { listas: tanda } = await leerListasPrecios(cliente, { estado: 'activas', pagina, tamano: TANDA_ACTIVAS })
    listas.push(...tanda)
    if (tanda.length < TANDA_ACTIVAS) break
  }
  return listas
}

// La lista de un cliente (para mostrarla en su ficha aunque esté archivada). null si no existe o no se puede leer.
export async function leerListaPorId(cliente: SupabaseClient, id: string): Promise<ListaPrecios | null> {
  const { data, error } = await cliente.from('listas_precios_resumen').select(COLUMNAS).eq('id', id).maybeSingle<FilaResumen>()
  if (error) throw error
  return data ? mapearLista(data) : null
}

// Bandera `listas_precios` (apagada por defecto). Ante cualquier duda se considera apagada: la pantalla no ofrece escribir.
export async function leerBanderaListasPrecios(cliente: SupabaseClient): Promise<boolean> {
  const { data, error } = await cliente.from('banderas_plataforma').select('activa').eq('clave', 'listas_precios').maybeSingle<{ activa: boolean }>()
  if (error) throw error
  return data?.activa === true
}

export type DatosLista = {
  // null = alta.
  id: string | null
  nombre: string
  descripcion: string
  ajusteTexto: string
  // updated_at tal como lo devolvió la base (edición).
  actualizadoEn: string | null
}

// «-20», «-12,5», «+10», «0,25». Acepta coma o punto; hasta 2 decimales; de -90 a +100. Inválido → null.
export function parsearAjuste(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, '').replace('%', '')
  if (!/^[+-]?\d+([.,]\d{1,2})?$/.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  if (!Number.isFinite(valor) || valor < AJUSTE_MINIMO || valor > AJUSTE_MAXIMO) return null
  return valor
}

export type ErroresLista = Partial<Record<'nombre' | 'descripcion' | 'ajuste', string>>

const MENSAJE_AJUSTE = 'Ingresá un porcentaje entre -90 y +100, con hasta 2 decimales.'

export function validarLista(datos: Pick<DatosLista, 'nombre' | 'descripcion' | 'ajusteTexto'>): ErroresLista {
  const errores: ErroresLista = {}
  const nombre = datos.nombre.trim()
  if (nombre.length === 0) errores.nombre = 'Escribí el nombre de la lista.'
  else if (nombre.length > LARGO_NOMBRE) errores.nombre = `El nombre no puede superar los ${LARGO_NOMBRE} caracteres.`
  if (datos.descripcion.trim().length > LARGO_DESCRIPCION) errores.descripcion = `La descripción no puede superar los ${LARGO_DESCRIPCION} caracteres.`
  if (parsearAjuste(datos.ajusteTexto) === null) errores.ajuste = MENSAJE_AJUSTE
  return errores
}

const formatoPorcentaje = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// «-20 %», «+10 %», «0 %».
export function formatearAjuste(ajuste: number): string {
  const signo = ajuste > 0 ? '+' : ajuste < 0 ? '-' : ''
  return `${signo}${formatoPorcentaje.format(Math.abs(ajuste))} %`
}

const formatoPesos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const PRECIO_EJEMPLO = 10000

// Ejemplo ilustrativo del diálogo: no consulta la base ni calcula un precio real (el redondeo y la tienda los resuelve el motor).
export function ejemploAjuste(ajuste: number): string {
  return `$ ${formatoPesos.format(PRECIO_EJEMPLO * (1 + ajuste / 100))}`
}

export async function guardarLista(cliente: SupabaseClient, datos: DatosLista): Promise<string> {
  const ajuste = parsearAjuste(datos.ajusteTexto)
  if (ajuste === null) throw new Error('El ajuste no es válido')
  const { data, error } = await cliente.rpc('guardar_lista_precios', {
    p_id: datos.id,
    p_nombre: datos.nombre.trim(),
    p_descripcion: datos.descripcion.trim() === '' ? null : datos.descripcion.trim(),
    p_ajuste_pct: ajuste,
    p_actualizado: datos.actualizadoEn,
  })
  if (error) throw error
  return data as string
}

export async function archivarLista(cliente: SupabaseClient, lista: Pick<ListaPrecios, 'id' | 'actualizadoEn'>): Promise<void> {
  const { error } = await cliente.rpc('archivar_lista_precios', { p_id: lista.id, p_actualizado: lista.actualizadoEn })
  if (error) throw error
}

export async function restaurarLista(cliente: SupabaseClient, lista: Pick<ListaPrecios, 'id' | 'actualizadoEn'>): Promise<void> {
  const { error } = await cliente.rpc('restaurar_lista_precios', { p_id: lista.id, p_actualizado: lista.actualizadoEn })
  if (error) throw error
}

// `listaId` null = quitar la lista del cliente.
export async function asignarListaPrecios(cliente: SupabaseClient, clienteId: string, listaId: string | null): Promise<void> {
  const { error } = await cliente.rpc('asignar_lista_precios_cliente', { p_cliente: clienteId, p_lista: listaId })
  if (error) throw error
}

// Lista de precios que el cliente tiene ahora en la base (null = sin lista). Se relee antes de compensar una asignación.
export async function leerListaDeCliente(cliente: SupabaseClient, clienteId: string): Promise<string | null> {
  const { data, error } = await cliente.schema('dominio').from('clientes').select('lista_precio_id').eq('id', clienteId).maybeSingle<{ lista_precio_id: string | null }>()
  if (error) throw error
  if (!data) throw new Error('El cliente ya no existe.')
  return data.lista_precio_id ?? null
}

// Traduce el código de la base (contrato en specs/…/contracts) a un texto para la persona.
export function mensajeErrorLista(error: unknown, porDefecto: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  switch (e.code) {
    case '42501':
      return 'Solo un administrador puede cambiar las listas de precios.'
    case '55000':
      return MOTIVO_LISTAS_APAGADAS
    case '23505':
      return 'Ya existe una lista con ese nombre.'
    case '23514':
    case '22003':
      return MENSAJE_AJUSTE
    case '40001':
      return 'Otra persona modificó esta lista. Recargá la pantalla y probá de nuevo.'
    case 'P0002':
      return 'La lista o el cliente ya no existe.'
    case '23503':
    case '22023':
      return e.message && e.message.length < 200 ? e.message : porDefecto
    default:
      return porDefecto
  }
}
