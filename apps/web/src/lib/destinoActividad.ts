import { registrarDestinoActividad, type EventoActividad } from './eventosActividad'
import { supabaseClient } from './supabase'

// Destino real del punto de emisión de `eventosActividad.ts` (F-AUD-01, FR-007):
// lleva los eventos empresa.* a `public.registrar_actividad`. La organización y
// el actor los fija el servidor; acá solo viaja tipo, detalle y empresa. Si
// falla, `emitirEventoActividad` lo atrapa y no revierte la edición.
const ETIQUETA_CAMPO: Readonly<Record<string, string>> = {
  nombre: 'nombre',
  whatsapp: 'WhatsApp',
  correo: 'correo',
  instagram: 'Instagram',
  direccion: 'dirección',
  horarios: 'horarios de atención',
}

export function detalleDeEvento(evento: EventoActividad): string {
  switch (evento.tipo) {
    case 'empresa.pausada':
      return 'Se pausó la tienda'
    case 'empresa.reactivada':
      return 'Se reactivó la tienda'
    case 'empresa.actualizada': {
      const campos = evento.cambios.map((cambio) => ETIQUETA_CAMPO[cambio.campo] ?? cambio.campo)
      return campos.length > 0
        ? `Se actualizaron los datos de la empresa (campos: ${campos.join(', ')})`
        : 'Se guardaron los datos de la empresa'
    }
  }
}

export async function enviarEventoAlRegistro(evento: EventoActividad): Promise<void> {
  const { error } = await supabaseClient.rpc('registrar_actividad', {
    p_tipo: evento.tipo,
    p_detalle: detalleDeEvento(evento),
    p_empresa_id: evento.empresaId,
  })
  if (error) {
    throw new Error(error.message)
  }
}

export function instalarDestinoActividad() {
  registrarDestinoActividad(enviarEventoAlRegistro)
}
