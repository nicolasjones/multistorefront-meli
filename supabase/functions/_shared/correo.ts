// Envío de correo de negocio por el SMTP de Supabase (F-ROL-05, FR-008). Supabase no ofrece una API
// de correo transaccional con contenido libre: solo manda los correos de Auth por su SMTP. Se usa ese
// mismo SMTP (Mailpit en local, el relay de GOTRUE_SMTP_* en el servidor self-hosted) con las
// credenciales en variables de entorno de la función. Nunca llegan al navegador.
// Todo el cableado (variables, límites, sondeo) vive en `smtp.ts` y `envio.ts`, probados con `node --test`; acá solo van los
// constructores reales de Deno.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { armarEnvioDesdeEntorno, type EnviarCorreo, type MensajeCorreo } from './smtp.ts'
import { lineaSegura } from './texto.ts'

export type { EnviarCorreo, MensajeCorreo }

// `lineaSegura` vive en texto.ts (sin dependencias de Deno, probable con node --test); se reexporta.
export { lineaSegura }

/** @public */
export const enviarPorSmtp: EnviarCorreo = armarEnvioDesdeEntorno({
  env: (clave) => Deno.env.get(clave),
  // denomailer conecta dentro de `send`: el sondeo TCP aparte separa «no se pudo alcanzar el servidor» (no salió nada).
  crearCliente: (opciones) => new SMTPClient(opciones),
  abrirConexion: (opciones) => Deno.connect(opciones),
})
