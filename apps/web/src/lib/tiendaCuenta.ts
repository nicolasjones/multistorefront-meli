import { mensajeIngresoBloqueado } from '../providers/authProvider'
import { supabaseClient } from './supabase'

// F-CLI-06 (MSF-428): ingreso, sesión y salida de la cuenta web del cliente en una tienda (FR-020, FR-021).
// La cuenta web NO es miembro del panel: solo «entra» si `publico.acceso_cliente_por_dominio` dice `activa`.

// Mismo texto ante credenciales incorrectas y ante una cuenta no activa en esta tienda (suspendida, sin cuenta o
// no habilitada): no revela cuál de los casos ocurrió (FR-021).
export const MENSAJE_INGRESO_GENERICO = 'Correo o contraseña incorrectos.'
export const MENSAJE_INGRESO_FALLA = 'No pudimos verificar tu acceso. Intentá de nuevo.'

// Mismo aviso exista o no la cuenta (FR-023): no se puede averiguar qué correos tienen cuenta en la tienda.
export const AVISO_RECUPERACION = 'Si existe una cuenta para ese correo en esta tienda, enviamos un enlace para definir una contraseña nueva.'

export type TipoCliente = 'minorista' | 'mayorista'
export type EstadoAccesoCliente = 'activa' | 'suspendida' | 'sin_cuenta' | 'no_habilitado'
type AccesoCliente = { estado: EstadoAccesoCliente; tipo: TipoCliente | null }

export type ResultadoIngreso =
  | { ok: true; tipo: TipoCliente | null }
  | { ok: false; mensaje: string }

// Estado efectivo de la sesión actual en la tienda del host. `null` = host/tienda desconocida. Lanza si la
// consulta falla (la sesión no se cierra por un error de red: el llamador decide).
export async function consultarAcceso(host: string): Promise<AccesoCliente | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('acceso_cliente_por_dominio', { host })
  if (error) throw new Error(error.message)
  return (data ?? null) as AccesoCliente | null
}

// Alcance local: la misma cuenta de Auth puede tener sesiones en otro lado (panel u otra tienda) y un ingreso
// rechazado aquí no debe cerrarlas.
async function cerrarSesion(): Promise<void> {
  const { error } = await supabaseClient.auth.signOut({ scope: 'local' })
  if (error) console.error('tiendaCuenta: no se pudo cerrar la sesión', error.message)
}

export async function ingresarCliente(host: string, correo: string, contrasena: string): Promise<ResultadoIngreso> {
  const email = correo.trim().toLowerCase()
  // Bloqueo por intentos del template (FR-025), igual que en el panel y sin cambios: se consulta antes de contactar
  // a Auth y no depende de que el correo exista. Falla cerrado: si no se puede descartar el bloqueo, no se ingresa.
  const { data: bloqueado, error: bloqueoError } = await supabaseClient.rpc('bloqueo_acceso_hasta', { p_correo: email })
  if (bloqueoError) return { ok: false, mensaje: MENSAJE_INGRESO_FALLA }
  if (bloqueado) return { ok: false, mensaje: mensajeIngresoBloqueado }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: contrasena })
  if (error) {
    // Cualquier sesión abierta antes se cierra: un intento fallido no deja a otra persona ingresada.
    await cerrarSesion()
    // Solo las credenciales inválidas cuentan como fallo (una caída de red o un 429 no bloquean el correo).
    if (error.code === 'invalid_credentials') {
      const { data: bloqueadoAhora } = await supabaseClient.rpc('registrar_fallo_acceso', { p_correo: email })
      if (bloqueadoAhora) return { ok: false, mensaje: mensajeIngresoBloqueado }
    }
    return { ok: false, mensaje: MENSAJE_INGRESO_GENERICO }
  }
  try {
    const acceso = await consultarAcceso(host)
    if (acceso?.estado === 'activa') return { ok: true, tipo: acceso.tipo }
    await cerrarSesion()
    return { ok: false, mensaje: MENSAJE_INGRESO_GENERICO }
  } catch (cause) {
    console.error('tiendaCuenta: no se pudo consultar el acceso', cause instanceof Error ? cause.message : cause)
    await cerrarSesion()
    return { ok: false, mensaje: MENSAJE_INGRESO_FALLA }
  }
}

export async function salirCliente(): Promise<void> {
  await cerrarSesion()
}

// ¿Hay una sesión activa de cliente en esta tienda? Sin sesión → false. Una sesión que no es `activa` en esta
// tienda se cierra (suspensión al instante, FR-013) y también devuelve false. Un error de red NO cierra la sesión:
// se propaga para que la interfaz no dé por salido a quien solo perdió conexión.
export async function sesionActivaEnTienda(host: string): Promise<AccesoCliente | null> {
  const { data, error } = await supabaseClient.auth.getSession()
  if (error || !data.session) return null
  const acceso = await consultarAcceso(host)
  if (acceso?.estado === 'activa') return acceso
  await cerrarSesion()
  return null
}

// Pide el correo de recuperación a la Edge Function anónima (FR-023). Responde igual exista o no la cuenta, así
// que `true` solo significa «el pedido se procesó»; `false` es una falla de red o de validación del correo.
export async function solicitarRecuperacionCliente(host: string, correo: string): Promise<boolean> {
  const { error } = await supabaseClient.functions.invoke('recuperar-clave-cliente', {
    body: { host, correo: correo.trim().toLowerCase() },
  })
  if (error) {
    console.error('tiendaCuenta: no se pudo pedir la recuperación', error.message)
    return false
  }
  return true
}
