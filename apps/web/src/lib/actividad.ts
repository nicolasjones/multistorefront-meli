import { formatearNumeroImporte } from './formatoImporte'
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

// Etiqueta visible de cada tipo conocido (entidad.accion). Está completo: cubre TODOS los
// tipos que emiten las migraciones (los registra `private.insertar_actividad` y sus variantes)
// y los que emite el frontend (`eventosActividad.ts`). Un tipo que aún no figure acá (lo agrega
// otro componente) se muestra legible igual, con el diccionario de palabras de abajo.
export const ETIQUETA_TIPO_ACTIVIDAD: Readonly<Record<string, string>> = {
  'actividad.exportada': 'Actividad exportada',
  'campana_correo.baja': 'Baja del correo masivo',
  'campana_correo.crear': 'Campaña de correo creada',
  'categoria.creada': 'Categoría creada',
  'categoria.editada': 'Categoría editada',
  'categoria.eliminada': 'Categoría eliminada',
  'categoria.reordenada': 'Categorías reordenadas',
  'cliente.archivado': 'Cliente archivado',
  'cliente.creado': 'Cliente creado',
  'cliente.cuenta_creada': 'Cuenta web creada',
  'cliente.cuenta_reactivada': 'Cuenta web reactivada',
  'cliente.cuenta_restablecida': 'Clave de la cuenta web restablecida',
  'cliente.cuenta_suspendida': 'Cuenta web suspendida',
  'cliente.descuento_editado': 'Descuento de cliente editado',
  'cliente.editado': 'Cliente editado',
  'cliente.fusionado': 'Clientes fusionados',
  'cliente.lista_precio_asignada': 'Lista de precios del cliente',
  'cliente.restaurado': 'Cliente restaurado',
  'clientes.aceptacion_correo_marcada': 'Aceptación de correo marcada',
  'clientes.exportados': 'Clientes exportados',
  'comprobante.anulado': 'Comprobante anulado',
  'comprobante.cobro_registrado': 'Cobro registrado',
  'comprobante.cobro_revertido': 'Cobro revertido',
  'comprobante.confirmado': 'Comprobante confirmado',
  'comprobante.creado': 'Comprobante creado',
  'comprobante.documento_solicitado': 'Documento solicitado',
  'comprobante.editado': 'Comprobante editado',
  'comprobante.estado_cambiado': 'Estado de comprobante cambiado',
  'comprobante.impreso': 'Comprobante impreso',
  'comprobante.nota_credito_emitida': 'Nota de crédito emitida',
  'comprobante.reimpreso': 'Comprobante reimpreso',
  'consulta.asignada': 'Consulta reasignada',
  'consulta.avisos_actualizados': 'Avisos de consultas actualizados',
  'consulta.estado_cambiado': 'Estado de consulta cambiado',
  'consulta.nota_actualizada': 'Nota de consulta actualizada',
  'contacto.actualizado': 'Contacto actualizado',
  'contacto.anonimizado': 'Contacto anonimizado',
  'contacto.comprobante_desvinculado': 'Comprobante desvinculado del contacto',
  'contacto.comprobante_vinculado': 'Comprobante vinculado al contacto',
  'contacto.consulta_vinculada': 'Consulta vinculada al contacto',
  'contacto.creado': 'Contacto creado',
  'contrarreembolso.abierto': 'Contrarreembolso abierto',
  'contrarreembolso.cobrado': 'Contrarreembolso cobrado',
  'contrarreembolso.importe_ajustado': 'Importe del contrarreembolso ajustado',
  'cotizacion.alcance_cambiado': 'Alcance de la cotización cambiado',
  'cotizacion.cargada': 'Cotización cargada',
  'cotizacion.configuracion_guardada': 'Configuración de la cotización guardada',
  'cotizacion.descartada': 'Cotización descartada',
  'cuenta_cobro.creada': 'Cuenta de cobro creada',
  'cuenta_cobro.desactivada': 'Cuenta de cobro desactivada',
  'cuenta_cobro.editada': 'Cuenta de cobro editada',
  'cuenta_cobro.reactivada': 'Cuenta de cobro reactivada',
  'despacho.envio_guardado': 'Envío guardado',
  'despacho.estado_cambiado': 'Estado de despacho cambiado',
  'despacho.faltante_registrado': 'Faltante de despacho registrado',
  'empresa.creada': 'Empresa creada',
  'empresa.actualizada': 'Empresa actualizada',
  'empresa.pausada': 'Empresa pausada',
  'empresa.reactivada': 'Empresa reactivada',
  'empresa.regla_precio_actualizada': 'Regla de precio de la empresa actualizada',
  'envio_moto.abono_ajustado': 'Abono del envío por moto ajustado',
  'envio_moto.actualizado': 'Envío por moto actualizado',
  'envio_moto.registrado': 'Envío por moto registrado',
  'envio_moto.rendido': 'Envío por moto rendido',
  'estado.creado': 'Estado de reparación creado',
  'estado.desactivado': 'Estado de reparación desactivado',
  'estado.editado': 'Estado de reparación editado',
  'estado.reactivado': 'Estado de reparación reactivado',
  'estado.reordenado': 'Estados de reparación reordenados',
  'gasto.anulado': 'Gasto anulado',
  'gasto.creado': 'Gasto cargado',
  'gasto.editado': 'Gasto editado',
  'gasto.exportado': 'Gastos exportados',
  'importacion.cancelada': 'Importación cancelada',
  'importacion.finalizada': 'Importación finalizada',
  'importacion.iniciada': 'Importación iniciada',
  'ingreso.anulado': 'Ingreso anulado',
  'ingreso.registrado': 'Ingreso registrado',
  'invitacion.cancelada': 'Invitación cancelada',
  'invitacion.enviada': 'Invitación enviada',
  'invitacion.reenviada': 'Invitación reenviada',
  'lista_precios.archivada': 'Lista de precios archivada',
  'lista_precios.creada': 'Lista de precios creada',
  'lista_precios.editada': 'Lista de precios editada',
  'lista_precios.restaurada': 'Lista de precios restaurada',
  'modelo.creado': 'Modelo creado',
  'modelo.desactivado': 'Modelo desactivado',
  'modelo.editado': 'Modelo editado',
  'modelo.reactivado': 'Modelo reactivado',
  'opinion.aceptada': 'Opinión aceptada',
  'opinion.rechazada': 'Opinión rechazada',
  'pago.conciliacion_revertida': 'Conciliación de pago revertida',
  'pago.conciliado': 'Pago conciliado',
  'permisos.matriz_guardada': 'Permisos modificados',
  'permisos.matriz_restablecida': 'Permisos restablecidos',
  'precios.actualizacion_masiva': 'Actualización masiva de precios',
  'presupuesto.aceptado': 'Presupuesto aceptado',
  'presupuesto.copiado': 'Presupuesto copiado',
  'presupuesto.creado_desde_tienda': 'Presupuesto pedido desde la tienda',
  'presupuesto.enviado_por_correo': 'Presupuesto enviado por correo',
  'presupuesto.envio_fallido': 'Envío del presupuesto fallido',
  'presupuesto.facturado': 'Presupuesto facturado',
  'producto.activado': 'Producto activado',
  'producto.categoria_asignada': 'Categoría asignada',
  'producto.creado': 'Producto creado',
  'producto.desactivado': 'Producto desactivado',
  'producto.editado': 'Producto editado',
  'producto.empresas_actualizadas': 'Empresas del producto actualizadas',
  'producto.exportado': 'Productos exportados',
  'producto.imagen_agregada': 'Imagen agregada',
  'producto.imagen_eliminada': 'Imagen eliminada',
  'producto.precio_actualizado': 'Precio actualizado',
  'producto.precio_propio_fijado': 'Precio propio fijado',
  'producto.precio_propio_quitado': 'Precio propio quitado',
  'producto.relacionados_editados': 'Productos relacionados editados',
  'producto.variantes_editadas': 'Variantes del producto editadas',
  'promocion_precio.actualizada': 'Promoción de precio actualizada',
  'promocion_precio.anulada': 'Promoción de precio anulada',
  'promocion_precio.programada': 'Promoción de precio programada',
  'proveedor.contacto_agregado': 'Contacto del proveedor agregado',
  'proveedor.contacto_principal_cambiado': 'Contacto principal del proveedor cambiado',
  'proveedor.creado': 'Proveedor creado',
  'proveedor.desactivado': 'Proveedor desactivado',
  'proveedor.editado': 'Proveedor editado',
  'proveedor.reactivado': 'Proveedor reactivado',
  'proveedores.exportados': 'Proveedores exportados',
  'recalculo.aplicado': 'Recálculo aplicado',
  'recalculo.omitido': 'Recálculo omitido',
  'rentabilidad.costo_baja': 'Costo de rentabilidad dado de baja',
  'rentabilidad.costo_guardado': 'Costo de rentabilidad guardado',
  'rentabilidad.umbral_actualizado': 'Umbral de rentabilidad actualizado',
  'reparacion.adjunto_agregado': 'Adjunto de la reparación agregado',
  'reparacion.adjunto_quitado': 'Adjunto de la reparación quitado',
  'reparacion.anulada': 'Reparación anulada',
  'reparacion.aviso_enviado': 'Aviso de reparación enviado',
  'reparacion.aviso_whatsapp_solicitado': 'Aviso de reparación por WhatsApp solicitado',
  'reparacion.aviso_fallido': 'Aviso de reparación fallido',
  'reparacion.aviso_solicitado': 'Aviso de reparación solicitado',
  'reparacion.comprobante_generado': 'Comprobante de reparación generado',
  'reparacion.creada': 'Reparación creada',
  'reparacion.editada': 'Reparación editada',
  'reparacion.enlace_generado': 'Enlace de consulta generado',
  'reparacion.enlace_regenerado': 'Enlace de consulta regenerado',
  'reparacion.entregada': 'Reparación entregada',
  'reparacion.estado_cambiado': 'Estado de reparación cambiado',
  'reparacion.item_agregado': 'Ítem de la reparación agregado',
  'reparacion.item_quitado': 'Ítem de la reparación quitado',
  'cliente.lista_precio_asignada_masiva': 'Lista de precios asignada en masa',
  'lista_precios.tipo_asignada': 'Lista de precios asignada a un tipo de cliente',
  'reparacion.reingreso_garantia': 'Reingreso por garantía',
  'respuesta_rapida.creada': 'Respuesta rápida creada',
  'respuesta_rapida.editada': 'Respuesta rápida editada',
  'respuesta_rapida.eliminada': 'Respuesta rápida eliminada',
  'resumen_semanal.pausado': 'Resumen semanal pausado',
  'resumen_semanal.reanudado': 'Resumen semanal reanudado',
  'rma.estado_cambiado': 'Estado de devolución cambiado',
  'rma.nota_credito_vinculada': 'Nota de crédito vinculada',
  'rma.registrada': 'Devolución registrada',
  'rma.stock_reingresado': 'Stock reingresado',
  'sistema.consultas_anonimizadas': 'Consultas anonimizadas por retención',
  'sistema.depurada': 'Historial depurado',
  'soporte.ingreso': 'Ingreso de soporte',
  'soporte.salida': 'Salida de soporte',
  'soporte.vencido': 'Vencimiento del acceso de soporte',
  'stock.ajuste': 'Ajuste de stock',
  'stock.carga_inicial': 'Carga inicial de stock',
  'stock.deposito_activo': 'Depósito activado o desactivado',
  'stock.deposito_creado': 'Depósito creado',
  'stock.deposito_defecto': 'Depósito por defecto cambiado',
  'stock.deposito_editado': 'Depósito editado',
  'stock.entrada': 'Entrada de stock',
  'stock.faltantes_avisados': 'Faltantes avisados',
  'stock.lote_registrado': 'Lote registrado',
  'stock.minimo': 'Stock mínimo modificado',
  'stock.reserva': 'Reserva de stock',
  'stock.reserva_descontada': 'Reserva descontada',
  'stock.reserva_liberada': 'Reserva liberada',
  'stock.salida': 'Salida de stock',
  'stock.traslado': 'Traslado de stock',
  'tienda.borrador_descartado': 'Borrador de la tienda descartado',
  'tienda.catalogo_actualizado': 'Catálogo de la tienda actualizado',
  'tienda.contenido_actualizado': 'Contenido de la tienda actualizado',
  'tienda.dominio_configurado': 'Dominio de la tienda configurado',
  'tienda.dominio_verificado': 'Dominio de la tienda verificado',
  'tienda.identidad_actualizada': 'Identidad de la tienda actualizada',
  'tienda.publicada': 'Tienda publicada',
  'tienda.version_restaurada': 'Versión de la tienda restaurada',
  'usuario.agregado': 'Usuario agregado',
  'usuario.empresa_activa_cambiada': 'Cambio de empresa activa',
  'usuario.empresas_asignadas': 'Empresas asignadas',
  'usuario.reactivado': 'Usuario reactivado',
  'usuario.removido': 'Usuario removido',
  'usuario.rol_cambiado': 'Cambio de rol',
  'usuario.suspendido': 'Usuario suspendido',
  'ventas.faltantes_avisados': 'Aviso de faltantes encolado',
  'ventas.faltantes_para_avisar': 'Faltantes marcados para avisar',
  'ventas.faltantes_para_avisar_demorado': 'Aviso de faltantes demorado',
  'newsletter.configurar': 'Newsletter de la tienda activado o desactivado',
  'newsletter.guardar': 'Borrador de newsletter guardado',
  'newsletter.prueba': 'Prueba de newsletter pedida',
  'newsletter.enviar': 'Newsletter enviado',
  'newsletter.cancelar': 'Envío de newsletter cancelado',
  'newsletter.baja': 'Baja del newsletter desde el enlace',
  'newsletter.tope_confirmaciones': 'Tope de confirmaciones por hora del newsletter alcanzado',
  'newsletter.baja_manual': 'Suscriptor del newsletter dado de baja',
  'newsletter.datos_borrados': 'Datos de un suscriptor del newsletter borrados',
}

// Palabras del tipo que llevan tilde o mayúsculas propias cuando no hay etiqueta explícita:
// son el respaldo para un tipo que otro componente agregue después.
const PALABRA_ACTIVIDAD: Readonly<Record<string, string>> = {
  campana_correo: 'campaña de correo',
  categoria: 'categoría',
  consulta: 'consulta',
  cotizacion: 'cotización',
  credito: 'crédito',
  cuenta_cobro: 'cuenta de cobro',
  envio: 'envío',
  envio_moto: 'envío por moto',
  importacion: 'importación',
  opinion: 'opinión',
  reparacion: 'reparación',
  respuesta_rapida: 'respuesta rápida',
  rma: 'RMA',
}

// Texto de la columna «Tienda»: lo comparten la tabla y el CSV exportado (F-AUD-03, FR-012).
export function tiendaDelEvento(empresaNombre: string | null, empresaId: string | null): string {
  return empresaNombre ?? (empresaId ? 'Empresa no disponible' : 'Compartido')
}

// Texto de la columna «Quién» (lista, detalle y exportación). Un evento sin actor es «Sistema», salvo el presupuesto que pide un cliente desde la tienda
// (MSF-176, B2, FR-060): no lo hace el sistema ni una persona del panel, lo hace la persona desde la tienda; el cliente queda identificado en el detalle del evento.
export const TIPO_PRESUPUESTO_DESDE_TIENDA = 'presupuesto.creado_desde_tienda'
export function quienDelEvento(tipo: string, actorNombre: string | null): string {
  if (actorNombre) return actorNombre
  return tipo === TIPO_PRESUPUESTO_DESDE_TIENDA ? 'Tienda online' : 'Sistema'
}

export function etiquetaTipoActividad(tipo: string): string {
  const conocida = ETIQUETA_TIPO_ACTIVIDAD[tipo]
  if (conocida) return conocida
  const [entidad, accion] = tipo.split('.')
  const texto = `${entidad ?? ''} ${(accion ?? '').replace(/_/g, ' ')}`
    .trim()
    .split(' ')
    .map((palabra) => PALABRA_ACTIVIDAD[palabra] ?? palabra)
    .join(' ')
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

// Símbolo de cada moneda: el mismo que usa el resto del panel («$» pesos, «US$» dólares).
const SIMBOLO_MONEDA: Readonly<Record<string, string>> = { ARS: '$', USD: 'US$' }


// «859100» o «90919.40» (punto decimal) / «90919,40» (coma) -> «859.100,00» / «90.919,40».
function importeLegible(texto: string): string {
  const numero = Number(texto.replace(',', '.'))
  return Number.isFinite(numero) ? formatearNumeroImporte(numero, { centavos: 'siempre' }) : texto
}

// Importe del detalle: «Cobro de [moneda] N», «[moneda] N» o «$ N». La moneda la trae el texto
// que armó la base («ARS» o «USD»); si no la trae, el importe es de pesos.
const RE_IMPORTE_DETALLE = /(Cobro de (?:ARS |USD )?|\b(?:ARS|USD) |\$ )(\d+(?:[.,]\d+)?)(?![\d.,]*\d)/g

// Los detalles guardados traen los importes crudos. Al mostrarlos se les da formato de moneda:
// «Cobro de $ 859.100,00», «Cobro de US$ 100,50», «$ 1.250,50». No toca otros números.
export function formatearDetalleActividad(detalle: string): string {
  return detalle.replace(RE_IMPORTE_DETALLE, (_texto, prefijo: string, numero: string) => {
    const moneda = prefijo.match(/\b(ARS|USD) /)?.[1]
    const simbolo = moneda ? SIMBOLO_MONEDA[moneda] : '$'
    const cabeza = prefijo.startsWith('Cobro de ') ? `Cobro de ${simbolo} ` : `${simbolo} `
    return `${cabeza}${importeLegible(numero)}`
  })
}

// Detalle de un evento (F-AUD-02, FR-006/FR-007): trae el valor anterior y el nuevo.
export type ValoresActividad = Record<string, unknown>

export type DetalleActividad = EventoActividadListado & {
  sensible: boolean
  valorAnterior: ValoresActividad | null
  valorNuevo: ValoresActividad | null
}

export type CampoCambiado = { campo: string; anterior: string; nuevo: string }

const SIN_VALOR = '—'

function textoDelValor(valor: unknown): string {
  if (valor === undefined || valor === null || valor === '') return SIN_VALOR
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'object') return JSON.stringify(valor)
  return String(valor)
}

// Campos de importe del antes → después. Criterio acotado por nombre de columna: la columna es (o empieza con) una palabra
// de importe (`total`, `precio_unitario`, `monto_pagado`, `costo_unitario_usd`…), salvo que termine en una palabra de
// conteo, porcentaje o identificador (`total_items`, `total_filas`, `descuento_pct`). Un nombre nuevo fuera de este
// criterio se ve sin formato de moneda: se agrega acá.
const RE_CAMPO_IMPORTE = /^(importe|monto|costo|precio|saldo|subtotal|total|descuento|recargo|valor|cobrado|deuda)(_[a-z0-9_]+)?$/
const RE_CAMPO_NO_IMPORTE = /_(pct|porcentaje|items|filas|cuentas|cantidad|id|dias|orden|recalculados)$/

// Excepciones explícitas: columnas que el criterio por prefijo tomaría por importe y no lo son (`total_clientes` es un
// conteo, `saldo_stock` son unidades). Se muestran crudas. Una columna nueva con prefijo de importe que no sea dinero
// se agrega acá.
const CAMPOS_QUE_NO_SON_IMPORTE: ReadonlySet<string> = new Set(['total_clientes', 'saldo_stock'])

// `valor` de `costos_adicionales_canal` es un porcentaje o un monto según su `tipo` (el mismo registro). Solo se formatea
// como moneda cuando el `tipo` de ese lado es `monto`; con `porcentaje` se deja crudo. Sin `tipo` (otras entidades con un
// `valor` de importe, p. ej. la cotización) rige el criterio por nombre.
const esCampoImporte = (clave: string, tipoDelRegistro?: unknown) => {
  if (CAMPOS_QUE_NO_SON_IMPORTE.has(clave)) return false
  if (clave === 'valor' && tipoDelRegistro === 'porcentaje') return false
  return RE_CAMPO_IMPORTE.test(clave) && !RE_CAMPO_NO_IMPORTE.test(clave)
}

function textoDelCampo(clave: string, valor: unknown, tipoDelRegistro?: unknown): string {
  const crudo = textoDelValor(valor)
  if (crudo === SIN_VALOR || !esCampoImporte(clave, tipoDelRegistro) || typeof valor === 'boolean' || typeof valor === 'object') return crudo
  const texto = String(valor).trim()
  return /^-?\d+(?:[.,]\d+)?$/.test(texto) ? importeLegible(texto) : crudo
}

function etiquetaDelCampo(clave: string): string {
  return clave.charAt(0).toUpperCase() + clave.slice(1).replace(/_/g, ' ')
}

// Campo por campo, antes → después, en el orden en que se registraron (anterior primero, luego los que solo
// existen en el nuevo). Un campo que no existía de un lado se muestra «—».
export function camposDelCambio(anterior: ValoresActividad | null, nuevo: ValoresActividad | null): CampoCambiado[] {
  const antes = anterior ?? {}
  const despues = nuevo ?? {}
  const claves = [...Object.keys(antes), ...Object.keys(despues).filter((clave) => !(clave in antes))]
  return claves.map((clave) => ({
    campo: etiquetaDelCampo(clave),
    anterior: textoDelCampo(clave, antes[clave], antes.tipo),
    nuevo: textoDelCampo(clave, despues[clave], despues.tipo),
  }))
}
