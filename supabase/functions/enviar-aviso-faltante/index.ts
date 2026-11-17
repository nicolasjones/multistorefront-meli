import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { tokenDeEntorno } from '../_shared/token.ts'
import { manejar } from './handler.ts'
import { armarDepsDesdeEntorno, opcionesClienteServicio } from './servidor.ts'

// El token compartido con Kestra no puede ser el valor de ejemplo ni uno corto (ver `_shared/token.ts`): la función
// responde 503 «no configurada» en vez de aceptarlo.
const env = (clave: string) => clave === 'AVISOS_FALTANTES_TOKEN'
  ? tokenDeEntorno(Deno.env.get(clave), Deno.env.get('AVISOS_PERMITIR_TOKEN_DEBIL'))
  : Deno.env.get(clave)

// Todo el cableado (variables, sonda, token) está en `servidor.ts`, probado con `node --test`.
Deno.serve((req) => {
  const cliente = createClient(...opcionesClienteServicio(env))
  return manejar(req, armarDepsDesdeEntorno({ env, cliente, enviar: enviarPorSmtp }))
})
