import { supabaseClient } from './supabase'
import type { CampoContacto, DatosContacto } from '../pages/tienda-publica/contacto/validacion'

// F-TDA-16 (MSF-437): datos de contacto de la tienda y envío del formulario. Qué datos se muestran, la
// validación definitiva, el límite de envíos y la entrega a la bandeja los decide la base
// (migración 20261210140000_tienda_contacto.sql); acá solo se llama y se traduce a estados de pantalla.

export type ContactoTienda = {
  nombre: string
  whatsapp: string | null
  correo: string | null
  horarios: string | null
}

// publico.contacto_por_dominio es ejecutable por anon. `null` cubre host desconocido y empresa desactivada.
export async function leerContactoTienda(host: string): Promise<ContactoTienda | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('contacto_por_dominio', { host })
  if (error) throw new Error(error.message)
  if (!data) return null
  const fila = data as ContactoTienda
  return { nombre: fila.nombre, whatsapp: fila.whatsapp, correo: fila.correo, horarios: fila.horarios }
}

// Resultado del envío traducido a lo que muestra la pantalla (el estado `enviando` lo lleva el formulario).
export type ResultadoEnvio =
  | { estado: 'exito' }
  | { estado: 'invalido'; campos: CampoContacto[] }
  | { estado: 'espera'; esperaSegundos: number }
  | { estado: 'falla' }

type RespuestaEnvio = {
  estado?: string
  campos?: string[]
  espera_segundos?: number
}

const CAMPOS: CampoContacto[] = ['nombre', 'contacto', 'mensaje']

// Una `clave_envio` por intento (idempotencia, FR-004): «Reintentar» reutiliza la misma; «Enviar otra» pide una nueva.
export function nuevaClaveEnvio(): string {
  return crypto.randomUUID()
}

export function traducirRespuestaEnvio(respuesta: RespuestaEnvio | null | undefined): ResultadoEnvio {
  switch (respuesta?.estado) {
    case 'ok':
      return { estado: 'exito' }
    case 'invalido':
      return { estado: 'invalido', campos: CAMPOS.filter((campo) => respuesta.campos?.includes(campo)) }
    case 'limite':
      return { estado: 'espera', esperaSegundos: Math.max(1, Math.round(respuesta.espera_segundos ?? 60)) }
    default:
      return { estado: 'falla' }
  }
}

// Un corte de red o un error del servidor se traducen a `falla`: nunca se muestra el detalle técnico.
export async function enviarConsultaContacto(host: string, datos: DatosContacto, claveEnvio: string): Promise<ResultadoEnvio> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('enviar_consulta_contacto', {
      host,
      nombre: datos.nombre.trim(),
      contacto: datos.contacto.trim(),
      mensaje: datos.mensaje.trim(),
      clave_envio: claveEnvio,
    })
    if (error) {
      console.error('No se pudo enviar la consulta de contacto', error.message)
      return { estado: 'falla' }
    }
    return traducirRespuestaEnvio(data as RespuestaEnvio | null)
  } catch (excepcion) {
    console.error('No se pudo enviar la consulta de contacto', excepcion instanceof Error ? excepcion.message : excepcion)
    return { estado: 'falla' }
  }
}

// «Probá de nuevo en N minutos»: se redondea hacia arriba, mínimo 1.
export function minutosDeEspera(esperaSegundos: number): number {
  return Math.max(1, Math.ceil(esperaSegundos / 60))
}
