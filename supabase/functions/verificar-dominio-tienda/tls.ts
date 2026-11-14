// Comprobación TLS de `verificar-dominio-tienda` (F-TDA-05, FR-012) sin depender de Deno: las operaciones de red
// se inyectan para probar el cierre de conexiones con `node --test` (tls.test.ts). `index.ts` cablea `Deno.connect`
// y `Deno.startTls`.
//
// MSF-797: el timeout de 5 s antes solo rechazaba la promesa; la conexión TCP/TLS colgada seguía abierta
// hasta que el runtime la soltara. Ahora todo `Conn` que se abre se cierra siempre: al terminar, al vencer el
// tiempo y también si la conexión llega DESPUÉS del vencimiento (la promesa no cancelable de `Deno.connect`).

import { clasificarFalloTls, type Certificado } from './handler.ts'

// Lo mínimo que se le pide a una conexión (`Deno.Conn` lo cumple).
export type Conexion = { close(): void }

export type OperacionesTls = {
  // Abre la conexión TCP a la IP de la plataforma (puerto 443).
  conectar(ip: string): Promise<Conexion>
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

  const trabajo = (async () => {
    const abierta = await operaciones.conectar(ipPlataforma)
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
    }, tiempoMs)
  })

  try {
    await Promise.race([trabajo, limite])
    return 'activo'
  } catch (e) {
    return clasificarFalloTls(e instanceof Error ? `${e.name} ${e.message}` : String(e))
  } finally {
    clearTimeout(temporizador)
    // Cierra lo que haya a esta altura: la conexión TLS si se negoció (cierra también la TCP), si no la TCP.
    // `trabajo` puede seguir pendiente tras el vencimiento: su rechazo se absorbe y, si más tarde llega una conexión,
    // el propio `trabajo` la cierra (ver arriba).
    cerrarSinFallar(tls ?? tcp)
    trabajo.catch(() => undefined)
  }
}
