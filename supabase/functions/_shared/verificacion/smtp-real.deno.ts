// Verificación con Deno REAL del envío SMTP (denomailer 1.6.0), sin Supabase ni red externa: levanta un servidor SMTP mínimo en
// un puerto libre de 127.0.0.1 (acepta EHLO/MAIL/RCPT/DATA, captura el DATA crudo), manda correos de prueba con el MISMO camino que
// producción (`armarEnvioDesdeEntorno` de `smtp.ts`, con `SMTPClient` real) y compara lo recibido con el texto original byte a byte.
//
// Uso (desde la raíz del repo; Deno por npm si no está instalado):
//   npx deno run --allow-net=127.0.0.1 supabase/functions/_shared/verificacion/smtp-real.deno.ts
// Sale con código 0 si todo coincide y 1 si algún texto llega corrupto. Escribe el DATA crudo de cada caso en la salida si se pide
// `--crudo`. Es una verificación manual (necesita Deno y bajar denomailer de deno.land), no corre en CI.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { armarEnvioDesdeEntorno } from '../smtp.ts'

const crudo = Deno.args.includes('--crudo')
const decodificador = new TextDecoder()
const codificador = new TextEncoder()

/** Servidor SMTP mínimo: una conexión por correo; devuelve el DATA (sin el punto final, con el dot-stuffing deshecho). */
function servidor() {
  const oyente = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  const puerto = (oyente.addr as Deno.NetAddr).port
  const recibidos: string[] = []
  const atender = (async () => {
    for await (const conn of oyente) {
      ;(async () => {
        const escribir = (s: string) => conn.write(codificador.encode(s + '\r\n'))
        await escribir('220 prueba ESMTP')
        let buffer = ''
        let enData = false
        let data = ''
        const lector = conn.readable.getReader()
        try {
          while (true) {
            const { value, done } = await lector.read()
            if (done) break
            buffer += decodificador.decode(value, { stream: true })
            if (enData) {
              const fin = buffer.indexOf('\r\n.\r\n')
              if (fin >= 0) {
                data = buffer.slice(0, fin + 2)
                buffer = buffer.slice(fin + 5)
                recibidos.push(data.replace(/^\.\./gm, '.'))
                enData = false
                await escribir('250 OK')
              }
              continue
            }
            let i
            while ((i = buffer.indexOf('\r\n')) >= 0) {
              const linea = buffer.slice(0, i)
              buffer = buffer.slice(i + 2)
              const cmd = linea.toUpperCase()
              if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) await escribir('250 prueba')
              else if (cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) await escribir('250 OK')
              else if (cmd.startsWith('DATA')) { await escribir('354 fin con <CRLF>.<CRLF>'); enData = true; break }
              else if (cmd.startsWith('QUIT')) { await escribir('221 chau'); conn.close(); return }
              else await escribir('250 OK')
            }
          }
        } catch { /* conexión cerrada */ }
      })()
    }
  })()
  return { puerto, recibidos, cerrar: () => { oyente.close(); return atender.catch(() => undefined) } }
}

// --- decodificación de lo recibido (lo que haría un cliente de correo) ---
// denomailer arma multipart/mixed > multipart/alternative > text/plain; se toma el cuerpo de la parte text/plain.
function cuerpoDe(data: string): { cabeceras: string; cuerpo: string; codificacion: string } {
  const cabeceras = data.split('\r\n\r\n')[0]
  const parte = /Content-Type: text\/plain[^\r\n]*\r\n(?:Content-Transfer-Encoding: ([^\r\n]+)\r\n)?\r\n([\s\S]*?)\r\n--message/i.exec(data)
  return { cabeceras, cuerpo: parte?.[2] ?? '', codificacion: (parte?.[1] ?? '7bit').trim().toLowerCase() }
}

function decodificar(cuerpo: string, codificacion: string): string {
  if (codificacion === 'base64') {
    const bin = atob(cuerpo.replace(/\s+/g, ''))
    return decodificador.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  }
  if (codificacion === 'quoted-printable') {
    const sinSaltos = cuerpo.replace(/=\r?\n/g, '')
    const bytes: number[] = []
    for (let i = 0; i < sinSaltos.length; i++) {
      if (sinSaltos[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(sinSaltos.slice(i + 1, i + 3))) { bytes.push(parseInt(sinSaltos.slice(i + 1, i + 3), 16)); i += 2 } else bytes.push(...codificador.encode(sinSaltos[i]))
    }
    return decodificador.decode(Uint8Array.from(bytes))
  }
  return cuerpo
}

const normalizar = (t: string) => t.replace(/\r\n/g, '\n')

// --- casos: líneas largas con caracteres no ASCII a distintas distancias del límite de 76 columnas ---
const base = 'x'.repeat(60)
const casos: [string, string][] = []
for (let relleno = 0; relleno < 12; relleno++) {
  const r = 'a'.repeat(relleno)
  casos.push([`«·» tras ${relleno}`, `- Funda de silicona (PRUEBA-MSF161-P1) ${r} · 3 u. · Comprobante A-0001\n- ${base} ñandú é á ü ${r} · 1 u.`])
}
casos.push(['aviso real', 'Hola Cliente Ñandú,\n\nHola, volvió el stock.\n\nPasá por la tienda.\n\n- Funda de silicona (PRUEBA-MSF161-P1) · 3 u. · Comprobante A-0001\n- Cable USB-C ñoño (SKU-ñ) · 12 u. · Comprobante A-0002\n'])
casos.push(['emojis', `Listo 😀😀😀 ${base} 👨‍👩‍👧 ${base} ✅ fin`])
casos.push(['línea con solo punto', 'hola\n.\nMAIL FROM:<x@y.com>\n..dos puntos\nfin'])
casos.push(['línea larga sin espacios', 'ñ'.repeat(200)])
casos.push(['muchas líneas largas', Array.from({ length: 30 }, (_, i) => `línea ${i} ` + 'é·'.repeat(25)).join('\n')])

const srv = servidor()
const envio = armarEnvioDesdeEntorno({
  env: (k) => ({ SMTP_HOST: '127.0.0.1', SMTP_FROM: 'avisos@ejemplo.com', SMTP_PORT: String(srv.puerto), SMTP_TLS: 'false', SMTP_PERMITIR_INSEGURO: 'true', SMTP_SONDEO: 'false' } as Record<string, string>)[k],
  // SMTPClient.close() devuelve Promise<void>; el cast evita el desajuste de tipos preexistente (igual en correo.ts).
  crearCliente: (opciones) => new SMTPClient(opciones) as never,
  abrirConexion: (opciones) => Deno.connect(opciones),
})

let fallos = 0
for (const [nombre, texto] of casos) {
  const antes = srv.recibidos.length
  const asunto = nombre === 'aviso real' ? 'Ya tenemos stock de lo que pediste · ñandú' : 'Ya tenemos stock de lo que pediste'
  await envio({ para: ['cliente@ejemplo.com'], asunto, texto })
  await new Promise((r) => setTimeout(r, 30))
  const data = srv.recibidos[antes] ?? ''
  const { cabeceras, cuerpo, codificacion } = cuerpoDe(data)
  const recibido = decodificar(cuerpo, codificacion)
  const igual = normalizar(recibido).trimEnd() === normalizar(texto).trimEnd()
  const lineasLargas = cuerpo.split('\r\n').filter((l) => l.trimEnd().length > 76).length
  if (!igual) fallos += 1
  console.log(`${igual ? 'OK     ' : 'CORRUPTO'} ${nombre.padEnd(26)} codificación=${codificacion} líneas>76=${lineasLargas}`)
  if (nombre === 'aviso real') console.log('         cabecera Subject:', /^Subject: .*$/im.exec(cabeceras)?.[0])
  if (!igual && !crudo) console.log('         recibido:', JSON.stringify(recibido.slice(0, 160)), '\n         original:', JSON.stringify(texto.slice(0, 160)))
  if (crudo) console.log(data)
}
await srv.cerrar()
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} caso(s) con el texto corrupto`)
Deno.exit(fallos === 0 ? 0 : 1)
