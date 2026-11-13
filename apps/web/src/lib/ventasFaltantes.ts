import { supabaseClient } from './supabase'
import { ESTADOS_STOCK, type EstadoStock } from './stock'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Faltantes de venta (F-VTA-18, MSF-201, épica MSF-135, FR-043, FR-044 y FR-047).
//
// La autoridad es la base: `listar_faltantes` (migración 20270112130300) trae los faltantes ABIERTOS con
// cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde» y el stock de hoy; y
// `registrar_faltantes_despacho` (migración 20270112130200) registra los faltantes de una factura en Armando
// y la deja Incompleta. Acá solo se nombran los tipos, se rotula el stock de hoy y se envuelven las dos RPC.

/**
 * Aviso al cliente de un faltante (F-VTA-26 y F-VTA-27): lo deriva la base de la cola de correo y de «Para avisar».
 * `en_cola` = el aviso espera su envío; `avisado` = el correo salió (MSF-161, QA M5).
 */
export type AvisoFaltante = 'sin_avisar' | 'para_avisar' | 'en_cola' | 'avisado'

/** Código genérico del último fallo de un aviso (`ultimo_error` de la cola): el detalle técnico no llega a la pantalla. */
export type CodigoErrorAviso =
  | 'smtp_auth' | 'smtp_conexion' | 'smtp_timeout' | 'destinatario_invalido' | 'sin_correo'
  | 'faltante_cerrado' | 'intentos_agotados' | 'otro'

/** Una fila del listado de faltantes (una línea de una factura que quedó sin stock). */
export type FaltanteVenta = {
  id: string
  empresa_id: string
  /** Tienda del faltante. */
  empresa: string
  cliente: string
  producto: string
  /** Producto de la línea (para la miniatura); null si la línea no tiene producto. */
  producto_id: string | null
  sku: string | null
  /** Unidades que faltaron de lo pedido. */
  cantidad_faltante: number
  /** Línea de la factura (1..n). */
  linea_orden: number
  comprobante_id: string
  /** Número del comprobante («0003-00001251»). */
  comprobante: string
  /** Fecha del pedido. */
  fecha: string
  /** Cuándo se registró el faltante (columna «Desde»). */
  desde: string
  /** Estado del stock del producto hoy: `sin_stock`, `stock_bajo` o `disponible`. */
  stock_estado: EstadoStock | null
  /** Unidades disponibles del producto hoy. */
  stock_disponible: number | null
  /** Estado del aviso al cliente (columna «Aviso»). */
  aviso: AvisoFaltante
  /** Fecha del aviso (`avisado` o `en_cola`) o de la marca «Para avisar»; null si está sin avisar. */
  aviso_en: string | null
  /** Código del último fallo si el aviso quedó agotado (chip «Aviso fallido»); null si no hubo fallo. */
  aviso_error: CodigoErrorAviso | null
}

export type PaginaFaltantes = {
  faltantes: FaltanteVenta[]
  /** Total de faltantes que cumplen el filtro (todas las páginas). */
  total: number
}

type FilaListado = Omit<FaltanteVenta, 'cantidad_faltante' | 'linea_orden' | 'stock_disponible'> & {
  cantidad_faltante: number | string
  linea_orden: number | string
  stock_disponible: number | string | null
  filas: number | string
}

const FECHA_AVISO = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** «dd/mm/aaaa» de la fecha de un aviso, en hora de Buenos Aires. */
export const fechaDeAviso = (iso: string): string => FECHA_AVISO.format(new Date(iso))

/** Texto y variante del chip de la columna «Aviso». */
export function etiquetaAviso(faltante: Pick<FaltanteVenta, 'aviso' | 'aviso_en'>): { texto: string; variante: VarianteEtiqueta } {
  if (faltante.aviso === 'avisado') {
    return { texto: faltante.aviso_en ? `Avisado · ${fechaDeAviso(faltante.aviso_en)}` : 'Avisado', variante: 'exito' }
  }
  // El aviso está encolado: el correo sale en el próximo barrido; «Avisado» recién cuando salió.
  if (faltante.aviso === 'en_cola') return { texto: 'En cola', variante: 'info' }
  if (faltante.aviso === 'para_avisar') return { texto: 'Para avisar', variante: 'info' }
  return { texto: 'Sin avisar', variante: 'neutral' }
}

const MOTIVO_AVISO_FALLIDO: Record<CodigoErrorAviso, string> = {
  smtp_auth: 'el servidor de correo rechazó las credenciales',
  smtp_conexion: 'no se pudo conectar con el servidor de correo',
  smtp_timeout: 'el servidor de correo no respondió a tiempo y el correo pudo haber salido: revisalo antes de reintentar',
  destinatario_invalido: 'el correo del cliente no es una dirección válida',
  sin_correo: 'el cliente no tiene correo',
  faltante_cerrado: 'el faltante se cerró antes de enviar el aviso',
  intentos_agotados: 'se agotaron los intentos de envío',
  otro: 'no se pudo enviar el correo',
}

/**
 * Chip «Aviso fallido» (M-1): el último intento de aviso de la fila se agotó sin enviarse. `motivo` explica en
 * castellano el código genérico de la base (nunca un detalle técnico). Null si el aviso no falló.
 */
export function avisoFallido(faltante: Pick<FaltanteVenta, 'aviso_error'>): { texto: string; motivo: string; variante: VarianteEtiqueta } | null {
  if (!faltante.aviso_error) return null
  const motivo = MOTIVO_AVISO_FALLIDO[faltante.aviso_error] ?? MOTIVO_AVISO_FALLIDO.otro
  return { texto: 'Aviso fallido', motivo: `No se pudo avisar: ${motivo}.`, variante: 'error' }
}

// «Stock hoy»: el estado del producto con la misma lectura de Stock que usa la pantalla de Stock
// (`public.stock_estados`). El prototipo lo muestra como etiqueta.
export function estadoStockHoy(estado: EstadoStock | null | undefined): { texto: string; variante: VarianteEtiqueta } {
  if (!estado) return { texto: 'Sin dato', variante: 'neutral' }
  const encontrado = ESTADOS_STOCK.find((e) => e.valor === estado)
  return { texto: encontrado?.etiqueta ?? estado, variante: encontrado?.variante ?? 'neutral' }
}

/** Las unidades disponibles de hoy, con la unidad en singular o plural. */
export function unidadesDisponibles(disponible: number | null | undefined): string {
  if (disponible === null || disponible === undefined) return '—'
  return `${disponible} ${disponible === 1 ? 'unidad' : 'unidades'}`
}

/**
 * Las unidades que faltan de una línea del pedido (columna «Pedido» de la pantalla, FR-044):
 * el número con la unidad en singular o plural.
 */
export function unidadesFaltantes(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'unidad' : 'unidades'}`
}

// Faltantes de una factura: línea y cantidad faltante (FR-047).
export type FaltanteARegistrar = {
  linea_orden: number
  cantidad: number
}

export const MENSAJE_CANTIDAD_VACIA = 'Ingresá la cantidad faltante.'
export const MENSAJE_CANTIDAD_NO_NUMERO = 'La cantidad faltante tiene que ser un número entero.'
export const MENSAJE_CANTIDAD_CERO = 'La cantidad faltante tiene que ser mayor a cero.'
export const MENSAJE_CANTIDAD_EXCEDE = 'La cantidad faltante no puede ser mayor a lo pedido.'

/**
 * Valida la cantidad faltante de una línea contra lo pedido en esa línea (mismo límite que la RPC:
 * entre 1 y lo pedido). Devuelve el mensaje de error o `null` si está bien.
 */
export function validarCantidadFaltante(texto: string, cantidadPedida: number): string | null {
  const limpio = texto.trim()
  if (limpio === '') return MENSAJE_CANTIDAD_VACIA
  if (!/^\d{1,7}$/.test(limpio)) return MENSAJE_CANTIDAD_NO_NUMERO
  const valor = Number(limpio)
  if (valor < 1) return MENSAJE_CANTIDAD_CERO
  if (valor > cantidadPedida) return MENSAJE_CANTIDAD_EXCEDE
  return null
}

export const MENSAJE_ERROR_LISTADO = 'No pudimos cargar los faltantes. Probá de nuevo.'
export const MENSAJE_ERROR_REGISTRAR = 'No pudimos registrar los faltantes. No se guardó nada: probá de nuevo.'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: volvé a registrar los faltantes.'
export const MENSAJE_SIN_PERMISO = 'Tu rol no puede registrar faltantes en esta tienda.'
export const MENSAJE_FUERA_DE_ESTADO = 'Los faltantes se registran con la factura en Armando o Incompleto.'
export const MENSAJE_COMPROBANTE_INEXISTENTE = 'Ese comprobante no existe o no pertenece a tu organización.';

// Los mensajes que levanta la RPC llegan en castellano y se muestran tal cual; el resto se traduce por código.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión',
  'Elegí al menos una línea faltante',
  'Una factura admite hasta',
  'La línea',
  'La cantidad faltante',
  'Solo las facturas',
  'Esta factura todavía no tiene estado de despacho',
  'Los faltantes se registran',
  'Tu rol no puede registrar faltantes',
  'Alguien modificó',
] as const

type ErrorDeBase = { code?: string; message?: string } | null

/**
 * El bloqueo optimista devolvió `40001`: otra persona cambió el comprobante mientras el diálogo estaba abierto.
 * La pantalla tiene que releerlo para que el reintento no vuelva a fallar con el `updated_at` vencido.
 */
export const esConflictoDeFaltantes = (error: unknown): boolean => (error as ErrorDeBase)?.code === '40001'

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

/** Traduce el error de la RPC a un mensaje en castellano para la persona. */
export function mensajeDeErrorFaltantes(error: unknown, porDefecto: string): string {
  const e = error as ErrorDeBase
  console.error(porDefecto, e?.code ?? 'sin código')
  if (e?.code === '40001') return MENSAJE_CONFLICTO
  if (e?.code === 'P0002') return MENSAJE_COMPROBANTE_INEXISTENTE
  if (e?.code === '55000') return MENSAJE_FUERA_DE_ESTADO
  if (e?.code === '42501') return MENSAJE_SIN_PERMISO
  if (e?.code === '22023' && esMensajeDeLaRpc(e)) return e.message
  return porDefecto
}

/**
 * Faltantes abiertos de las empresas accesibles, paginados en el servidor.
 * `empresaId` filtra por tienda; `null` muestra todas (el valor por defecto de la pantalla).
 */
export async function listarFaltantes({
  empresaId,
  pagina,
  tamano,
  aviso,
}: {
  empresaId: string | null
  pagina: number
  tamano: number
  /** Filtro por aviso (`sin_avisar`, `para_avisar`, `en_cola` o `avisado`); sin valor se listan todos. */
  aviso?: AvisoFaltante | null
}): Promise<PaginaFaltantes> {
  const { data, error } = await supabaseClient.rpc('listar_faltantes', {
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
    p_aviso: aviso ?? null,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    faltantes: filas.map(({ filas: _filas, ...faltante }) => ({
      ...faltante,
      cantidad_faltante: Number(faltante.cantidad_faltante),
      linea_orden: Number(faltante.linea_orden),
      aviso: faltante.aviso ?? 'sin_avisar',
      aviso_en: faltante.aviso_en ?? null,
      aviso_error: faltante.aviso_error ?? null,
      stock_disponible:
        faltante.stock_disponible === null || faltante.stock_disponible === undefined
          ? null
          : Number(faltante.stock_disponible),
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

/**
 * Registra los faltantes de una factura y la deja Incompleto (FR-041).
 * `actualizadoEn` es el `updated_at` leído al abrir el comprobante (bloqueo optimista, 40001 ante conflicto).
 */
export async function registrarFaltantes({
  comprobanteId,
  actualizadoEn,
  faltantes,
}: {
  comprobanteId: string
  actualizadoEn: string
  faltantes: FaltanteARegistrar[]
}): Promise<void> {
  const { error } = await supabaseClient.rpc('registrar_faltantes_despacho', {
    p_id: comprobanteId,
    p_faltantes: faltantes.map((faltante) => ({
      linea_orden: faltante.linea_orden,
      cantidad: faltante.cantidad,
    })),
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
}

// Avisar a los clientes (F-VTA-26, FR-001…FR-005). La base decide qué se encola (`avisar_faltantes_venta`):
// la pantalla solo manda los ids, el texto editable y la confirmación para volver a avisar.

export const MAXIMO_AVISO_FALTANTES = 200
export const MAXIMO_MENSAJE_AVISO = 1000
/** Texto del correo si la persona no lo cambia: es el mismo que usa la Edge Function sin mensaje. */
export const TEXTO_AVISO_POR_DEFECTO = 'Volvió a haber stock de los productos que tenías pedidos:'

export const MENSAJE_ERROR_AVISAR = 'No pudimos enviar los avisos. Probá de nuevo.'
export const MENSAJE_SIN_PERMISO_AVISAR = 'Tu rol no puede avisar faltantes.'

export type ResultadoAvisoVenta = {
  encolados: number
  lineas_avisadas: number
  omitidos_ya_avisados: number
  omitidos_en_cola: number
  omitidos_sin_correo: number
  omitidos_sin_permiso: number
  omitidos_no_abiertos: number
  /** Enviados hace menos de 24 h: no se vuelven a avisar (M-3). */
  omitidos_reaviso_reciente: number
  /** Pasaron el tope diario de avisos de la organización (M-3). */
  omitidos_tope_diario: number
  detalle: { id: string; resultado: string }[]
}

const CONTEOS_AVISO_VENTA = [
  'encolados',
  'lineas_avisadas',
  'omitidos_ya_avisados',
  'omitidos_en_cola',
  'omitidos_sin_correo',
  'omitidos_sin_permiso',
  'omitidos_no_abiertos',
] as const

// Los topes (M-3) son conteos opcionales: una base anterior a la migración 20270306120000 no los manda.
const CONTEOS_OPCIONALES = ['omitidos_reaviso_reciente', 'omitidos_tope_diario'] as const

function esResultadoAvisoVenta(valor: unknown): valor is ResultadoAvisoVenta {
  if (typeof valor !== 'object' || valor === null) return false
  const datos = valor as Record<string, unknown>
  return (
    CONTEOS_AVISO_VENTA.every((clave) => typeof datos[clave] === 'number') &&
    CONTEOS_OPCIONALES.every((clave) => datos[clave] === undefined || typeof datos[clave] === 'number') &&
    Array.isArray(datos.detalle)
  )
}

/**
 * Avisa a los clientes de los faltantes elegidos. `mensaje` vacío o igual al texto por defecto viaja como
 * `null` (la base usa el texto por defecto y agrupa los avisos de un mismo cliente en un solo correo).
 * Los errores llegan siempre en castellano y sin detalle técnico.
 */
export async function avisarFaltantesVenta(
  ids: readonly string[],
  mensaje: string,
  reavisar: boolean,
): Promise<ResultadoAvisoVenta> {
  if (ids.length === 0 || ids.length > MAXIMO_AVISO_FALTANTES) {
    throw new Error(`Elegí entre 1 y ${MAXIMO_AVISO_FALTANTES} faltantes para avisar.`)
  }
  const texto = mensaje.trim()
  if (texto.length > MAXIMO_MENSAJE_AVISO) {
    throw new Error(`El texto del aviso no puede tener más de 1.000 caracteres.`)
  }
  const { data, error } = await supabaseClient.rpc('avisar_faltantes_venta', {
    p_ids: [...ids],
    p_mensaje: texto === '' || texto === TEXTO_AVISO_POR_DEFECTO ? null : texto,
    p_reavisar: reavisar,
  })
  if (error) {
    console.error(MENSAJE_ERROR_AVISAR, (error as ErrorDeBase)?.code ?? 'sin código')
    throw new Error((error as ErrorDeBase)?.code === '42501' ? MENSAJE_SIN_PERMISO_AVISAR : MENSAJE_ERROR_AVISAR)
  }
  if (!esResultadoAvisoVenta(data)) throw new Error(MENSAJE_ERROR_AVISAR)
  return { ...data, omitidos_reaviso_reciente: data.omitidos_reaviso_reciente ?? 0, omitidos_tope_diario: data.omitidos_tope_diario ?? 0 }
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/**
 * Texto del aviso emergente: «Avisos en cola» (el correo sale en el próximo barrido: todavía no se envió) y, si
 * se omitió algo, qué y por qué. Si no se encoló ningún correo dice «No se enviaron avisos». `clientePorId` (id del faltante → cliente) permite contar clientes
 * distintos sin correo en vez de faltantes.
 */
export function mensajeResultadoAvisoVenta(
  resultado: ResultadoAvisoVenta,
  clientePorId: Readonly<Record<string, string>> = {},
): string {
  const omitidos: string[] = []
  if (resultado.omitidos_sin_correo > 0) {
    const ids = resultado.detalle.filter((d) => d.resultado === 'sin_correo').map((d) => d.id)
    const nombres = [...new Set(ids.map((id) => clientePorId[id]).filter((c): c is string => Boolean(c)))]
    const n = ids.length > 0 ? new Set(ids.map((id) => clientePorId[id] ?? id)).size : resultado.omitidos_sin_correo
    // FR-005: con los nombres de los clientes (los primeros cinco; el resto, «y N más»).
    const lista = nombres.length === 0 ? '' : `: ${nombres.slice(0, 5).join(', ')}${nombres.length > 5 ? ` y ${nombres.length - 5} más` : ''}`
    omitidos.push(n === 1 ? `El cliente no tiene correo${lista}.` : `${n} clientes no tienen correo${lista}.`)
  }
  const n = resultado.omitidos_ya_avisados
  if (n > 0) omitidos.push(`${plural(n, 'faltante ya estaba avisado', 'faltantes ya estaban avisados')}.`)
  const e = resultado.omitidos_en_cola
  if (e > 0) omitidos.push(`${plural(e, 'faltante tiene un envío en curso', 'faltantes tienen un envío en curso')}.`)
  const p = resultado.omitidos_sin_permiso
  if (p > 0) {
    omitidos.push(
      p === 1
        ? '1 faltante es de una tienda donde tu rol no puede avisar.'
        : `${p} faltantes son de tiendas donde tu rol no puede avisar.`,
    )
  }
  const r = resultado.omitidos_reaviso_reciente
  if (r > 0) {
    omitidos.push(`${plural(r, 'faltante se avisó hace menos de 24 horas y no se vuelve a avisar', 'faltantes se avisaron hace menos de 24 horas y no se vuelven a avisar')}.`)
  }
  const t = resultado.omitidos_tope_diario
  if (t > 0) {
    omitidos.push(`Se alcanzó el tope diario de avisos de tu organización: ${plural(t, 'faltante pasa', 'faltantes pasan')} a la siguiente ventana de 24 horas; volvé a avisar después.`)
  }
  const a = resultado.omitidos_no_abiertos
  if (a > 0) omitidos.push(`${plural(a, 'faltante ya no está abierto', 'faltantes ya no están abiertos')}.`)
  const base = resultado.encolados > 0 ? 'Avisos en cola.' : 'No se enviaron avisos.'
  return [base, ...omitidos].join(' ')
}
