// Envío de correo de negocio por el SMTP de Supabase (F-ROL-05, FR-008). Supabase no ofrece una API
// de correo transaccional con contenido libre: solo manda los correos de Auth por su SMTP. Se usa ese
// mismo SMTP (Mailpit en local, el relay de GOTRUE_SMTP_* en el servidor self-hosted) con las
// credenciales en variables de entorno de la función. Nunca llegan al navegador.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

export type MensajeCorreo = { para: string[]; asunto: string; texto: string }
export type EnviarCorreo = (mensaje: MensajeCorreo) => Promise<void>

// Quita saltos de línea de lo que va en cabeceras: el nombre de quien pide viene de datos de usuario.
export const lineaSegura = (valor: string) => valor.replace(/[\r\n]+/g, ' ').trim()

const enviarPorSmtp: EnviarCorreo = async ({ para, asunto, texto }) => {
  const hostname = Deno.env.get('SMTP_HOST')
  const from = Deno.env.get('SMTP_FROM')
  if (!hostname || !from) throw new Error('Falta configurar SMTP_HOST / SMTP_FROM')
  const usuario = Deno.env.get('SMTP_USER')
  const clave = Deno.env.get('SMTP_PASS')
  const cliente = new SMTPClient({
    connection: {
      hostname,
      port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
      // Mailpit local no usa TLS; el relay del servidor sí (SMTP_TLS=true).
      tls: Deno.env.get('SMTP_TLS') === 'true',
      ...(usuario && clave ? { auth: { username: usuario, password: clave } } : {}),
    },
  })
  try {
    await cliente.send({ from, to: para.map(lineaSegura), subject: lineaSegura(asunto), content: texto })
  } finally {
    await cliente.close().catch(() => undefined)
  }
}
