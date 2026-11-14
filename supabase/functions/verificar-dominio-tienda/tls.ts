// Comprobación TLS de `verificar-dominio-tienda` (F-TDA-05, FR-012) sin depender de Deno: las operaciones de red
// se inyectan para probar el cierre de conexiones con `node --test` (tls.test.ts). `index.ts` cablea `Deno.connect`
// y `Deno.startTls`.
//
// LIMITACIÓN CONOCIDA (no verificada en un Deno real): `Deno.startTls` consume la conexión TCP. Si el handshake TLS queda
// colgado, el único manejo que tenemos de ese socket es la TCP original; al vencer se INTENTA cerrarla y se tolera que ya haya
// sido consumida o cerrada (`cerrarSinFallar`). Si Deno la dio por consumida, no hay forma de cerrar el socket TLS en curso hasta
// que `startTls` resuelva o falle; cuando llegue tarde, esta función lo cierra. Impacto acotado: una conexión a la IP de la
// plataforma, a lo sumo una verificación cada 10 s por tienda, y el runtime la suelta al cortar el servidor.
//
// MSF-797: el timeout de 5 s antes solo rechazaba la promesa; la conexión TCP/TLS colgada seguía abierta
// hasta que el runtime la soltara. Ahora todo `Conn` que se abre se cierra siempre: al terminar, al vencer el
// tiempo y también si la conexión llega DESPUÉS del vencimiento (la promesa de `Deno.connect` no es cancelable,
// pero la señal que se le pasa sí: al abortarla, el runtime cierra el socket pendiente).

import { clasificarFalloTls, type Certificado } from './handler.ts'

// Lo mínimo que se le pide a una conexión (`Deno.Conn` lo cumple).
export type Conexion = { close(): void }

export type OperacionesTls = {
  // Abre la conexión TCP a la IP de la plataforma (puerto 443). La señal cancela la conexión si sigue pendiente
  // cuando vence el tiempo.
  conectar(ip: string, senal: AbortSignal): Promise<Conexion>
  // Negocia TLS sobre esa conexión validando el certificado contra `host`. Si resuelve, la conexión TCP pasa a ser la TLS.
  iniciarTls(tcp: Conexion, host: string): Promise<Conexion>
}

export const TIEMPO_TLS_MS = 5000

const cerrarSinFallar = (conexion: Conexion | null | undefined) => {
  if (!conexion) return
  try {
    conexion.close()
  } catch {
    // Ya estaba cerrada (BadResource): nada que hacer.
  }
}

// Conecta a la IP de la plataforma (guardada en la base) y valida el certificado contra el dominio: no se vuelve a
// resolver el nombre, así un DNS que cambie entre consultas no desvía la conexión.
export async function comprobarTls(
  host: string,
  ipPlataforma: string,
  operaciones: OperacionesTls,
  tiempoMs: number = TIEMPO_TLS_MS,
): Promise<Certificado> {
  let vencido = false
  let tcp: Conexion | null = null
  let tls: Conexion | null = null
  let temporizador: ReturnType<typeof setTimeout> | undefined
  // Cancela la conexión TCP que sigue pendiente cuando vence el tiempo (el socket queda cerrado en el runtime).
  const cancelacion = new AbortController()

  const trabajo = (async () => {
    const abierta = await operaciones.conectar(ipPlataforma, cancelacion.signal)
    tcp = abierta
    // Si el tiempo ya venció, nadie espera esta conexión: se cierra acá, no queda colgada.
    if (vencido) {
      cerrarSinFallar(abierta)
      throw new Error('timeout')
    }
    const segura = await operaciones.iniciarTls(abierta, host)
    tls = segura
    if (vencido) {
      cerrarSinFallar(segura)
      throw new Error('timeout')
    }
  })()

  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      vencido = true
      rechazar(new Error('timeout'))
      // El socket que quedó pendiente de conectar se cancela acá (no cuando la promesa resuelva más tarde).
      cancelacion.abort()
    }, tiempoMs)
  })

  try {
    await Promise.race([trabajo, limite])
    return 'activo'
  } catch (e) {
    return clasificarFalloTls(e instanceof Error ? `${e.name} ${e.message}` : String(e))
  } finally {
    clearTimeout(temporizador)
    // Cierra lo que haya a esta altura: la conexión TLS si se negoció (cierra también la TCP), si no INTENTA cerrar la TCP
    // (si `startTls` ya la consumió puede no tener efecto: ver la limitación de arriba).
    // `trabajo` puede seguir pendiente tras el vencimiento: su rechazo se absorbe y, si más tarde llega una conexión,
    // el propio `trabajo` la cierra (ver arriba).
    cerrarSinFallar(tls ?? tcp)
    trabajo.catch(() => undefined)
  }
}
