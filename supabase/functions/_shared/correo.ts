// Envío de correo de negocio por el SMTP de Supabase (F-ROL-05, FR-008). Supabase no ofrece una API
// de correo transaccional con contenido libre: solo manda los correos de Auth por su SMTP. Se usa ese
// mismo SMTP (Mailpit en local, el relay de GOTRUE_SMTP_* en el servidor self-hosted) con las
// credenciales en variables de entorno de la función. Nunca llegan al navegador.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { armarEnvio, type EnviarCorreo, type MensajeCorreo } from './smtp.ts'
import { lineaSegura } from './texto.ts'

export type { EnviarCorreo, MensajeCorreo }

// `lineaSegura` vive en texto.ts (sin dependencias de Deno, probable con node --test); se reexporta.
export { lineaSegura }

/** @public */
export const enviarPorSmtp: EnviarCorreo = async (mensaje) => {
  const hostname = Deno.env.get('SMTP_HOST')
  const from = Deno.env.get('SMTP_FROM')
  if (!hostname || !from) throw new Error('Falta configurar SMTP_HOST / SMTP_FROM')
  const envio = armarEnvio({
    config: {
      hostname,
      from,
      port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
      // Mailpit local no usa TLS; el relay del servidor sí (SMTP_TLS=true).
      tls: Deno.env.get('SMTP_TLS') === 'true',
      usuario: Deno.env.get('SMTP_USER'),
      clave: Deno.env.get('SMTP_PASS'),
    },
    crearCliente: ({ hostname: host, port, tls, usuario, clave }) =>
      new SMTPClient({
        connection: { hostname: host, port, tls, ...(usuario && clave ? { auth: { username: usuario, password: clave } } : {}) },
      }),
    // denomailer conecta dentro de `send`: un sondeo TCP aparte separa «no se pudo alcanzar el servidor» (no salió nada).
    conectar: async (host, port) => { (await Deno.connect({ hostname: host, port })).close() },
  })
  await envio(mensaje)
}
