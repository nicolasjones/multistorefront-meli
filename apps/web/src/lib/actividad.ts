// Historial de actividad (F-AUD-01, MSF-463): tipos, períodos y formato de
// fecha. Las fechas se calculan y muestran en America/Argentina/Buenos_Aires,
// nunca en UTC ni en la zona del navegador (FR-004).
export const ZONA_HORARIA_ACTIVIDAD = 'America/Argentina/Buenos_Aires'
export const TAMANO_PAGINA_ACTIVIDAD = 10

export type EventoActividadListado = {
  id: string
  creadoEn: string
  tipo: string
  empresaId: string | null
  empresaNombre: string | null
  actorId: string | null
  actorNombre: string | null
  detalle: string
}

export type PeriodoActividad = 'hoy' | '7dias' | '30dias' | 'todo'

export const ETIQUETA_PERIODO: Readonly<Record<PeriodoActividad, string>> = {
  hoy: 'Hoy',
  '7dias': 'Últimos 7 días',
  '30dias': 'Últimos 30 días',
  todo: 'Todo el historial',
}

export type FiltrosActividad = {
  periodo: PeriodoActividad
  empresa: string | null
  actor: string | null
  tipo: string | null
  texto: string
}

export const FILTROS_ACTIVIDAD_INICIALES: FiltrosActividad = {
  periodo: '7dias',
  empresa: null,
  actor: null,
  tipo: null,
  texto: '',
}

// Etiqueta visible de cada tipo conocido (entidad.accion). Un tipo que aún no
// figure acá (lo agrega otro componente) se muestra legible igual.
export const ETIQUETA_TIPO_ACTIVIDAD: Readonly<Record<string, string>> = {
  'empresa.actualizada': 'Empresa actualizada',
  'empresa.pausada': 'Empresa pausada',
  'empresa.reactivada': 'Empresa reactivada',
  'usuario.agregado': 'Usuario agregado',
  'usuario.rol_cambiado': 'Cambio de rol',
  'usuario.removido': 'Usuario removido',
  'usuario.empresa_activa_cambiada': 'Cambio de empresa activa',
  'usuario.empresas_asignadas': 'Empresas asignadas',
  'usuario.suspendido': 'Usuario suspendido',
  'usuario.reactivado': 'Usuario reactivado',
  'invitacion.enviada': 'Invitación enviada',
  'invitacion.reenviada': 'Invitación reenviada',
  'invitacion.cancelada': 'Invitación cancelada',
  'permisos.matriz_guardada': 'Permisos modificados',
  'permisos.matriz_restablecida': 'Permisos restablecidos',
  'cliente.creado': 'Cliente creado',
  'cliente.editado': 'Cliente editado',
  'cliente.archivado': 'Cliente archivado',
  'cliente.restaurado': 'Cliente restaurado',
  'cliente.descuento_editado': 'Descuento de cliente editado',
  'categoria.creada': 'Categoría creada',
  'categoria.editada': 'Categoría editada',
  'categoria.eliminada': 'Categoría eliminada',
  'categoria.reordenada': 'Categorías reordenadas',
  'cuenta_cobro.creada': 'Cuenta de cobro creada',
  'cuenta_cobro.editada': 'Cuenta de cobro editada',
  'cuenta_cobro.desactivada': 'Cuenta de cobro desactivada',
  'cuenta_cobro.reactivada': 'Cuenta de cobro reactivada',
  'comprobante.creado': 'Comprobante creado',
  'comprobante.editado': 'Comprobante editado',
  'comprobante.confirmado': 'Comprobante confirmado',
  'comprobante.anulado': 'Comprobante anulado',
  'comprobante.estado_cambiado': 'Estado de comprobante cambiado',
  'comprobante.cobro_registrado': 'Cobro registrado',
  'comprobante.documento_solicitado': 'Documento solicitado',
  'comprobante.impreso': 'Comprobante impreso',
  'comprobante.reimpreso': 'Comprobante reimpreso',
  'comprobante.nota_credito_emitida': 'Nota de crédito emitida',
  'modelo.creado': 'Modelo creado',
  'modelo.editado': 'Modelo editado',
  'modelo.desactivado': 'Modelo desactivado',
  'modelo.reactivado': 'Modelo reactivado',
  'producto.creado': 'Producto creado',
  'producto.editado': 'Producto editado',
  'producto.activado': 'Producto activado',
  'producto.desactivado': 'Producto desactivado',
  'producto.categoria_asignada': 'Categoría asignada',
  'producto.empresas_actualizadas': 'Empresas del producto actualizadas',
  'producto.imagen_agregada': 'Imagen agregada',
  'producto.imagen_eliminada': 'Imagen eliminada',
  'producto.precio_actualizado': 'Precio actualizado',
  'proveedor.creado': 'Proveedor creado',
  'proveedor.editado': 'Proveedor editado',
  'proveedor.desactivado': 'Proveedor desactivado',
  'proveedor.reactivado': 'Proveedor reactivado',
  'rma.registrada': 'Devolución registrada',
  'rma.estado_cambiado': 'Estado de devolución cambiado',
  'rma.nota_credito_vinculada': 'Nota de crédito vinculada',
  'rma.stock_reingresado': 'Stock reingresado',
  'stock.entrada': 'Entrada de stock',
  'stock.salida': 'Salida de stock',
  'stock.ajuste': 'Ajuste de stock',
  'stock.ajuste_manual': 'Ajuste manual de stock',
  'stock.actualizado': 'Stock actualizado',
  'stock.carga_inicial': 'Carga inicial de stock',
  'stock.traslado': 'Traslado de stock',
  'stock.minimo': 'Stock mínimo modificado',
  'stock.reserva': 'Reserva de stock',
  'stock.reserva_descontada': 'Reserva descontada',
  'stock.reserva_liberada': 'Reserva liberada',
  'stock.lote_registrado': 'Lote registrado',
  'stock.faltantes_avisados': 'Faltantes avisados',
  'stock.deposito_creado': 'Depósito creado',
  'stock.deposito_editado': 'Depósito editado',
  'stock.deposito_activo': 'Depósito activado o desactivado',
  'stock.deposito_defecto': 'Depósito por defecto cambiado',
  'ingreso.registrado': 'Ingreso registrado',
  'ingreso.anulado': 'Ingreso anulado',
}

export function etiquetaTipoActividad(tipo: string): string {
  const conocida = ETIQUETA_TIPO_ACTIVIDAD[tipo]
  if (conocida) return conocida
  const [entidad, accion] = tipo.split('.')
  const texto = `${entidad ?? ''} ${(accion ?? '').replace(/_/g, ' ')}`.trim()
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA_ACTIVIDAD,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Fecha calendario (YYYY-MM-DD) de un instante en hora de Buenos Aires.
export function diaEnBuenosAires(instante: Date): string {
  return formatoDia.format(instante)
}

function restarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

// Rango inclusivo de días que se pasa a listar_actividad. «Hoy» es el día de
// Buenos Aires aunque en UTC ya sea otro; «Últimos N días» incluye hoy.
export function rangoDelPeriodo(periodo: PeriodoActividad, ahora: Date = new Date()): { desde: string | null; hasta: string | null } {
  if (periodo === 'todo') return { desde: null, hasta: null }
  const hoy = diaEnBuenosAires(ahora)
  const dias = periodo === 'hoy' ? 0 : periodo === '7dias' ? 6 : 29
  return { desde: restarDias(hoy, dias), hasta: hoy }
}

const formatoCuando = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA_ACTIVIDAD,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// «dd/mm/aaaa hh:mm» en hora de Buenos Aires.
export function formatearCuando(iso: string): string {
  const partes = Object.fromEntries(formatoCuando.formatToParts(new Date(iso)).map((parte) => [parte.type, parte.value]))
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`
}

const formatoImporteDetalle = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// «859100» o «90919.40» (punto decimal) / «90919,40» (coma) -> «859.100,00» / «90.919,40».
function importeLegible(texto: string): string {
  const numero = Number(texto.replace(',', '.'))
  return Number.isFinite(numero) ? formatoImporteDetalle.format(numero) : texto
}

// Los detalles ya guardados traen los importes crudos. Se les da formato de
// moneda al mostrarlos: «Cobro de N», «$ N» y «ARS|USD N». No toca otros números.
export function formatearDetalleActividad(detalle: string): string {
  return detalle.replace(
    /(Cobro de |\$ |\b(?:ARS|USD) )(\d+(?:[.,]\d+)?)(?![\d.,]*\d)/g,
    (_, prefijo: string, n: string) => `${prefijo.startsWith('Cobro') ? 'Cobro de $ ' : prefijo}${importeLegible(n)}`,
  )
}
