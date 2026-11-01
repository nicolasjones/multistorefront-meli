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
  'campana_correo.baja': 'Baja de correo masivo',
  'campana_correo.crear': 'Campaña de correo creada',
  'categoria.creada': 'Categoría creada',
  'categoria.editada': 'Categoría editada',
  'categoria.eliminada': 'Categoría eliminada',
  'categoria.reordenada': 'Categorías reordenadas',
  'comprobante.anulado': 'Comprobante anulado',
  'comprobante.cobro_registrado': 'Cobro registrado',
  'comprobante.confirmado': 'Comprobante confirmado',
  'comprobante.creado': 'Comprobante creado',
  'comprobante.documento_solicitado': 'Documento solicitado',
  'comprobante.editado': 'Comprobante editado',
  'comprobante.estado_cambiado': 'Estado del comprobante cambiado',
  'comprobante.impreso': 'Comprobante impreso',
  'comprobante.nota_credito_emitida': 'Nota de crédito emitida',
  'comprobante.reimpreso': 'Comprobante reimpreso',
  'consulta.asignada': 'Consulta asignada',
  'consulta.avisos_actualizados': 'Avisos de consultas actualizados',
  'consulta.estado_cambiado': 'Estado de consulta cambiado',
  'consulta.nota_actualizada': 'Nota de consulta actualizada',
  'contrarreembolso.abierto': 'Contrarreembolso abierto',
  'contrarreembolso.cobrado': 'Contrarreembolso cobrado',
  'cotizacion.cargada': 'Cotización cargada',
  'cotizacion.descartada': 'Cotización descartada',
  'cuenta_cobro.creada': 'Cuenta de cobro creada',
  'cuenta_cobro.desactivada': 'Cuenta de cobro desactivada',
  'cuenta_cobro.editada': 'Cuenta de cobro editada',
  'cuenta_cobro.reactivada': 'Cuenta de cobro reactivada',
  'despacho.envio_guardado': 'Envío guardado',
  'despacho.estado_cambiado': 'Estado de despacho cambiado',
  'despacho.faltante_registrado': 'Faltante registrado',
  'empresa.regla_precio_actualizada': 'Regla de precio actualizada',
  'estado.creado': 'Estado creado',
  'estado.desactivado': 'Estado desactivado',
  'estado.editado': 'Estado editado',
  'estado.reactivado': 'Estado reactivado',
  'estado.reordenado': 'Estados reordenados',
  'ingreso.anulado': 'Ingreso de mercadería anulado',
  'ingreso.registrado': 'Ingreso de mercadería registrado',
  'modelo.creado': 'Modelo creado',
  'modelo.desactivado': 'Modelo desactivado',
  'modelo.editado': 'Modelo editado',
  'modelo.reactivado': 'Modelo reactivado',
  'pago.conciliacion_revertida': 'Conciliación revertida',
  'pago.conciliado': 'Pago conciliado',
  'presupuesto.aceptado': 'Presupuesto aceptado',
  'presupuesto.copiado': 'Presupuesto copiado',
  'presupuesto.enviado_por_correo': 'Presupuesto enviado por correo',
  'presupuesto.envio_fallido': 'Envío de presupuesto fallido',
  'producto.activado': 'Producto activado',
  'producto.categoria_asignada': 'Categoría asignada a producto',
  'producto.creado': 'Producto creado',
  'producto.desactivado': 'Producto desactivado',
  'producto.editado': 'Producto editado',
  'producto.empresas_actualizadas': 'Empresas del producto actualizadas',
  'producto.imagen_agregada': 'Imagen de producto agregada',
  'producto.imagen_eliminada': 'Imagen de producto eliminada',
  'producto.precio_actualizado': 'Precio de producto actualizado',
  'proveedor.creado': 'Proveedor creado',
  'proveedor.desactivado': 'Proveedor desactivado',
  'proveedor.editado': 'Proveedor editado',
  'proveedor.reactivado': 'Proveedor reactivado',
  'recalculo.aplicado': 'Recálculo aplicado',
  'recalculo.omitido': 'Recálculo omitido',
  'rentabilidad.umbral_actualizado': 'Umbral de rentabilidad actualizado',
  'reparacion.anulada': 'Reparación anulada',
  'reparacion.aviso_enviado': 'Aviso de reparación enviado',
  'reparacion.aviso_fallido': 'Aviso de reparación fallido',
  'reparacion.aviso_solicitado': 'Aviso de reparación solicitado',
  'reparacion.comprobante_generado': 'Comprobante de reparación generado',
  'reparacion.creada': 'Reparación creada',
  'reparacion.editada': 'Reparación editada',
  'reparacion.entregada': 'Reparación entregada',
  'reparacion.estado_cambiado': 'Estado de reparación cambiado',
  'reparacion.item_agregado': 'Ítem de reparación agregado',
  'reparacion.item_quitado': 'Ítem de reparación quitado',
  'rma.estado_cambiado': 'Estado de devolución cambiado',
  'rma.nota_credito_vinculada': 'Nota de crédito vinculada a la devolución',
  'rma.registrada': 'Devolución registrada',
  'rma.stock_reingresado': 'Stock reingresado por devolución',
  'stock.ajuste': 'Ajuste de stock',
  'stock.entrada': 'Entrada de stock',
  'stock.salida': 'Salida de stock',
  'stock.actualizado': 'Stock actualizado',
  'stock.carga_inicial': 'Carga inicial de stock',
  'stock.deposito_activo': 'Depósito activado o desactivado',
  'stock.deposito_creado': 'Depósito creado',
  'stock.deposito_defecto': 'Depósito por defecto cambiado',
  'stock.deposito_editado': 'Depósito editado',
  'stock.faltantes_avisados': 'Faltantes avisados',
  'stock.lote_registrado': 'Lote de stock registrado',
  'stock.minimo': 'Stock mínimo modificado',
  'stock.reserva': 'Stock reservado',
  'stock.reserva_descontada': 'Reserva de stock descontada',
  'stock.reserva_liberada': 'Reserva de stock liberada',
  'stock.traslado': 'Traslado de stock',
  'tienda.catalogo_actualizado': 'Catálogo de tienda actualizado',
  'tienda.contenido_actualizado': 'Contenido de tienda actualizado',
  'tienda.dominio_configurado': 'Dominio de tienda configurado',
  'tienda.identidad_actualizada': 'Identidad de tienda actualizada',
}

export function etiquetaTipoActividad(tipo: string): string {
  const conocida = ETIQUETA_TIPO_ACTIVIDAD[tipo]
  if (conocida) return conocida
  const [entidad, accion] = tipo.split('.')
  const texto = `${entidad ?? ''} ${accion ?? ''}`.replace(/_/g, ' ').trim()
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
