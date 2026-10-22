import { supabaseClient } from './supabase'
import type { ItemReparacion, Reparacion } from './reparaciones'

// Documentos imprimibles de una reparación (F-SVC-07): Orden de ingreso y Remito de entrega. Se arman solo con lo que
// devuelve `obtener_reparacion` y los datos de contacto de la tienda; no leen ni muestran costos internos ni ganancia
// (FR-044), tenga o no `ver_costos` quien imprime. Son documentos NO fiscales y los importes son sin IVA (FR-043).

export const ROTULO_NO_FISCAL = 'Documento no fiscal'
export const ROTULO_SIN_IVA = 'Importes sin IVA'

// Texto de condiciones provisorio (spec, Decisiones abiertas 3): pendiente de confirmar por el negocio.
export const CONDICIONES_PENDIENTES = 'Condiciones del servicio: pendiente de confirmar.'

export type DatosTienda = { nombre: string; direccion: string | null; whatsapp: string | null; correo: string | null }

export type FilaDocumento = { etiqueta: string; valor: string }

export type DocumentoOrden = {
  titulo: 'Orden de ingreso'
  tienda: DatosTienda
  numero: string
  filas: FilaDocumento[]
  condiciones: string
}

export type TablaItems = { titulo: string; filas: ItemReparacion[]; subtotal: number }

export type DocumentoRemito = {
  titulo: 'Remito de entrega'
  tienda: DatosTienda
  numero: string
  filas: FilaDocumento[]
  tablas: TablaItems[]
  sinItems: boolean
  total: number
  entrega: FilaDocumento[]
}

// `AAAA-MM-DD` → `dd/mm/aaaa` sin pasar por Date (evita el corrimiento por zona horaria).
export function formatearFechaDocumento(fecha: string | null): string {
  if (!fecha) return '—'
  const [anio, mes, dia] = fecha.slice(0, 10).split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha
}

// Lo que no está cargado se omite (FR-045): nunca se muestra un dato vacío ni inventado.
export function contactoDeTienda(tienda: DatosTienda): string[] {
  return [tienda.direccion, tienda.whatsapp ? `WhatsApp ${tienda.whatsapp}` : null, tienda.correo]
    .map((dato) => dato?.trim() ?? '')
    .filter((dato) => dato !== '')
}

function filasComunes(reparacion: Reparacion, tecnico: string | null): FilaDocumento[] {
  return [
    { etiqueta: 'Fecha de ingreso', valor: formatearFechaDocumento(reparacion.ingreso_en) },
    { etiqueta: 'Cliente', valor: reparacion.cliente },
    ...(reparacion.contacto.trim() ? [{ etiqueta: 'Contacto', valor: reparacion.contacto }] : []),
    { etiqueta: 'Equipo', valor: `${reparacion.equipo} ${reparacion.modelo}`.trim() },
    { etiqueta: 'N.º de serie', valor: reparacion.numero_serie?.trim() || '—' },
    { etiqueta: 'Accesorios recibidos', valor: reparacion.accesorios.trim() || '—' },
    { etiqueta: 'Falla informada', valor: reparacion.falla.trim() || '—' },
    { etiqueta: 'Técnico', valor: tecnico ?? 'Sin asignar' },
    { etiqueta: 'Entrega prevista', valor: formatearFechaDocumento(reparacion.entrega_prevista) },
  ]
}

export function armarOrdenIngreso(reparacion: Reparacion, tienda: DatosTienda, tecnico: string | null): DocumentoOrden {
  return {
    titulo: 'Orden de ingreso',
    tienda,
    numero: reparacion.codigo,
    filas: filasComunes(reparacion, tecnico),
    condiciones: CONDICIONES_PENDIENTES,
  }
}

// El remito solo existe para una reparación entregada y no anulada (FR-041).
export function remitoDisponible(reparacion: Reparacion): boolean {
  return reparacion.entrega_real !== null && reparacion.anulada_en === null
}

export function armarRemitoEntrega(reparacion: Reparacion, tienda: DatosTienda, tecnico: string | null): DocumentoRemito {
  const tabla = (tipo: ItemReparacion['tipo'], titulo: string): TablaItems => {
    const filas = reparacion.items.filter((item) => item.tipo === tipo)
    return { titulo, filas, subtotal: filas.reduce((suma, item) => suma + item.subtotal, 0) }
  }
  const tablas = [tabla('mano_obra', 'Mano de obra'), tabla('repuesto', 'Repuestos')]
  return {
    titulo: 'Remito de entrega',
    tienda,
    numero: reparacion.codigo,
    filas: filasComunes(reparacion, tecnico),
    tablas,
    sinItems: reparacion.items.length === 0,
    total: tablas.reduce((suma, t) => suma + t.subtotal, 0),
    entrega: [
      { etiqueta: 'Fecha de entrega', valor: formatearFechaDocumento(reparacion.entrega_real) },
      { etiqueta: 'Entregó', valor: reparacion.entregado_por?.trim() || '—' },
    ],
  }
}

type FilaEmpresa = { nombre: string; direccion: string | null; whatsapp: string | null; correo: string | null }

// Datos de la tienda desde `dominio.empresas` (FR-045). Sin CUIT ni domicilio fiscal: no existen hoy.
export async function obtenerDatosTienda(empresaId: string): Promise<DatosTienda> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('empresas')
    .select('nombre, direccion, whatsapp, correo')
    .eq('id', empresaId)
    .maybeSingle<FilaEmpresa>()
  if (error) throw error
  if (!data) throw new Error('No se encontró la tienda de la reparación.')
  return data
}
