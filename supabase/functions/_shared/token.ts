// Token compartido de las funciones de aviso (header x-aviso-token). Sin imports de Deno: `node --test` (token.test.ts).
//
// Los `.env.example` traen `change-me-local` para desarrollo local. Si un ambiente real quedó con ese valor (o con uno
// corto), cualquiera con la anon key —que es pública— podría disparar los barridos de correo: la función falla cerrado
// (503 «no configurada», el camino que ya existe cuando el token falta) en vez de aceptarlo.
export const LARGO_MINIMO_TOKEN = 32

export function tokenDeEntorno(valor: string | undefined, permitirDebil: string | undefined): string | undefined {
  if (!valor) return undefined
  // Solo local: `AVISOS_PERMITIR_TOKEN_DEBIL=true` (la trae supabase/functions/.env.example, nunca stg/prd).
  if (permitirDebil?.trim().toLowerCase() === 'true') return valor
  if (valor.length < LARGO_MINIMO_TOKEN || /^change-?me/i.test(valor)) return undefined
  return valor
}
