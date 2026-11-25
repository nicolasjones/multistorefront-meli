// Contrato: specs/20270203-100000-api-e-asistente-con-ia (chat IA).
//
// La lógica vive en handler.ts (probada con `pnpm test:edge:chat-ia-responder`); acá solo se cablean los clientes
// reales. Nunca service-role para datos de negocio: lo del usuario va con la clave anon y su JWT (RLS decide) y la
// service-role queda en el cliente admin (validar el JWT y resolver política/credencial).
import { createClient } from 'npm:@supabase/supabase-js@2'
// Ruta relativa, no 'npm:@platform/ia': @platform/ia es "private": true y nunca se publicó a npm. Deno compila TS nativo,
// así que importar el archivo fuente directo funciona sin build intermedio.
import { prepararInvocacion } from '../_shared/ia/index.ts'
import { fetchConTimeout } from '../_shared/fetch-ia.ts'
import { manejar, type Deps } from './handler.ts'

// Instrucción de sistema explícita: sin esto el modelo no tiene por qué
// preferir "leer"/"ejecutar" sobre responder de memoria, ni saber que debe
// decir que no tiene acceso en vez de inventar. Prompt base genérico — el
// producto derivado puede reemplazar este string por uno propio (su
// nombre, su dominio) editando esta constante localmente; el mecanismo no
// depende de su contenido.
const SYSTEM_PROMPT = Deno.env.get('CHAT_COMPANION_SYSTEM_PROMPT')
  ?? 'Sos un chat conversacional con acceso a los datos habilitados de esta organización. Respondé únicamente con datos obtenidos a través de las herramientas "leer" (para consultar datos) y "ejecutar" (para proponer una acción, nunca la ejecutes vos mismo). Si no encontrás la información con "leer", decí explícitamente que no tenés acceso a eso — nunca inventes información. No asumas que una funcionalidad está disponible: si "leer" devuelve FUENTE_NO_DISPONIBLE, es que esta organización no tiene acceso a esos datos.'

Deno.serve((req) => {
  const deps: Deps = {
    // Solo para validar el JWT y resolver política/credencial (service-role).
    crearAdmin: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    crearCliente: (jwt) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }),
    prepararInvocacion,
    fetchProveedor: (limiteSegundos) => fetchConTimeout(limiteSegundos),
    ahora: () => Date.now(),
    limiteHora: () => Deno.env.get('CHAT_IA_LIMITE_HORA'),
    systemPrompt: SYSTEM_PROMPT,
  }
  return manejar(req, deps)
})
