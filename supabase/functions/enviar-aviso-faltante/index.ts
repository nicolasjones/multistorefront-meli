import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarPorSmtp } from '../_shared/correo.ts'
import { manejar } from './handler.ts'
import { armarDepsDesdeEntorno, opcionesClienteServicio } from './servidor.ts'

const env = (clave: string) => Deno.env.get(clave)

// Todo el cableado (variables, sonda, token) está en `servidor.ts`, probado con `node --test`.
Deno.serve((req) => {
  const cliente = createClient(...opcionesClienteServicio(env))
  return manejar(req, armarDepsDesdeEntorno({ env, cliente, enviar: enviarPorSmtp }))
})
