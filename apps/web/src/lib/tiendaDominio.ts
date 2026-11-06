import { supabaseClient } from './supabase'

// F-TDA-05 (MSF-198): dominio de la tienda, verificación DNS y certificado. Los valores de la tabla de
// registros y el estado salen del servidor (`obtener_dominio_tienda`); acá no se calcula ni se escribe a
// mano ningún valor de DNS (FR-004).

export type EstadoRegistro = 'correcto' | 'incorrecto' | 'pendiente'
export type EstadoCertificado = 'pendiente' | 'activo' | 'error'

export type RegistroDns = {
  tipo: 'A' | 'CNAME' | 'TXT'
  nombre: string
  valor: string
  estado: EstadoRegistro
  encontrado: string | null
}

export type DominioTienda = {
  dominioVigente: string | null
  dominioPendiente: string | null
  redireccion: string | null
  dominioVerificado: boolean
  certificado: EstadoCertificado
  ultimaVerificacion: string | null
  registros: RegistroDns[]
}

type FilaDominio = {
  dominio_vigente: string | null
  dominio_pendiente: string | null
  redireccion: string | null
  dominio_verificado: boolean
  certificado: EstadoCertificado
  ultima_verificacion: string | null
  registros: RegistroDns[]
}

export async function leerDominioTienda(empresaId: string): Promise<DominioTienda> {
  const { data, error } = await supabaseClient.rpc('obtener_dominio_tienda', { p_empresa_id: empresaId })
  if (error) {
    throw new Error(error.message)
  }
  const fila = data as FilaDominio
  return {
    dominioVigente: fila.dominio_vigente,
    dominioPendiente: fila.dominio_pendiente,
    redireccion: fila.redireccion,
    dominioVerificado: fila.dominio_verificado,
    certificado: fila.certificado,
    ultimaVerificacion: fila.ultima_verificacion,
    registros: fila.registros ?? [],
  }
}

export type CampoDominio = 'dominio' | 'redireccion'

const ERRORES_DOMINIO: Record<string, { campo: CampoDominio; mensaje: string }> = {
  dominio_invalido: { campo: 'dominio', mensaje: 'Ingresá un dominio válido, por ejemplo mitienda.com.ar.' },
  dominio_en_uso: { campo: 'dominio', mensaje: 'Ese dominio ya lo usa otra tienda.' },
  redireccion_invalida: { campo: 'redireccion', mensaje: 'Ingresá un dominio válido y distinto del principal.' },
  redireccion_en_uso: { campo: 'redireccion', mensaje: 'Ese dominio ya lo usa otra tienda.' },
}

export class ErrorConfigurarDominio extends Error {
  campo: CampoDominio | null
  constructor(message: string, campo: CampoDominio | null) {
    super(message)
    this.campo = campo
  }
}

// Mismo criterio que la base (`private.dominio_tienda_valido`): se espeja solo para avisar antes de pedir.
const FORMATO_DOMINIO = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizarDominio(valor: string): string {
  return valor.trim().toLowerCase().replace(/\.+$/, '').replace(/:[0-9]*$/, '').replace(/\.+$/, '')
}

export type ErroresDominio = Partial<Record<CampoDominio, string>>

export function validarDominios(dominio: string, redireccion: string): ErroresDominio {
  const errores: ErroresDominio = {}
  const principal = normalizarDominio(dominio)
  if (!FORMATO_DOMINIO.test(principal) || principal.length > 253) {
    errores.dominio = ERRORES_DOMINIO.dominio_invalido.mensaje
  }
  const secundario = normalizarDominio(redireccion)
  if (secundario !== '' && (!FORMATO_DOMINIO.test(secundario) || secundario === principal)) {
    errores.redireccion = ERRORES_DOMINIO.redireccion_invalida.mensaje
  }
  return errores
}

export async function configurarDominio(empresaId: string, dominio: string, redireccion: string): Promise<void> {
  const { error } = await supabaseClient.rpc('configurar_dominio_tienda', {
    p_empresa_id: empresaId,
    p_dominio: dominio,
    p_redireccion: redireccion.trim() === '' ? null : redireccion,
  })
  if (error) {
    const conocido = ERRORES_DOMINIO[error.message]
    throw conocido ? new ErrorConfigurarDominio(conocido.mensaje, conocido.campo) : new Error(error.message)
  }
}

export type ResultadoVerificacion = {
  dominioVerificado: boolean
  certificado: EstadoCertificado
}

export type MotivoFalloVerificacion = 'demasiado_pronto' | 'dns_no_disponible' | 'sin_permiso' | 'otro'

export class ErrorVerificarDominio extends Error {
  motivo: MotivoFalloVerificacion
  constructor(motivo: MotivoFalloVerificacion) {
    super(motivo)
    this.motivo = motivo
  }
}

type RespuestaFuncion = { dominio_verificado: boolean; certificado: EstadoCertificado }

// La Edge Function `verificar-dominio-tienda` consulta DNS/TLS y guarda el resultado; el navegador solo
// envía la empresa y su sesión (nunca la service-role key).
export async function verificarDominio(empresaId: string): Promise<ResultadoVerificacion> {
  const { data, error } = await supabaseClient.functions.invoke<RespuestaFuncion>('verificar-dominio-tienda', {
    body: { empresa_id: empresaId },
  })
  if (error) {
    const respuesta = (error as { context?: Response }).context
    let codigo: string | null = null
    if (respuesta && typeof respuesta.json === 'function') {
      codigo = ((await respuesta.json().catch(() => null)) as { error?: string } | null)?.error ?? null
    }
    const motivo: MotivoFalloVerificacion =
      codigo === 'demasiado_pronto' || codigo === 'dns_no_disponible' || codigo === 'sin_permiso' ? codigo : 'otro'
    throw new ErrorVerificarDominio(motivo)
  }
  return { dominioVerificado: Boolean(data?.dominio_verificado), certificado: data?.certificado ?? 'pendiente' }
}

// «hace 6 h»: relativo y sin identificadores; «Nunca verificado» si no hay verificación.
export function textoUltimaVerificacion(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return 'Nunca verificado'
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60000))
  if (minutos < 1) return 'Última verificación hace un momento'
  if (minutos < 60) return `Última verificación hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `Última verificación hace ${horas} h`
  return `Última verificación hace ${Math.floor(horas / 24)} d`
}
