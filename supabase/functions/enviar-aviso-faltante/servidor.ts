// Cableado de `enviar-aviso-faltante` sin Deno ni supabase-js (se prueba con `node --test`): arma las dependencias del
// handler a partir del cliente de servicio, el token y el envío SMTP. `index.ts` solo llama a esto con lo real.
import type { EnviarCorreo } from '../_shared/correo.ts'
import { crearDatos } from './datos.ts'
import type { Deps } from './handler.ts'

type Rpc = Parameters<typeof crearDatos>[0]

export function armarDeps({ cliente, token, enviar }: { cliente: Rpc; token: string | undefined; enviar: EnviarCorreo }): Deps {
  const { datos, sonda } = crearDatos(cliente)
  // La sonda es parte del contrato: sin ella una base sin migrar gastaría intentos antes de fallar.
  return { token, datos, sonda, enviar }
}
