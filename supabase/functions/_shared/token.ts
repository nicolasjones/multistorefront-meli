// Token compartido de las funciones de aviso (header x-aviso-token). Sin imports de Deno: `node --test` (token.test.ts).
//
// Los `.env.example` traen `change-me-local` para desarrollo local. Si un ambiente real quedó con ese valor (o con uno
// corto), cualquiera con la anon key —que es pública— podría disparar los barridos de correo: la función falla cerrado
// (503 «no configurada», el camino que ya existe cuando el token falta) en vez de aceptarlo.
import { createHash, timingSafeEqual } from 'node:crypto'

export const LARGO_MINIMO_TOKEN = 32

export function tokenDeEntorno(valor: string | undefined, permitirDebil: string | undefined): string | undefined {
  if (!valor) return undefined
  // Solo local: `AVISOS_PERMITIR_TOKEN_DEBIL=true` (la trae supabase/functions/.env.example, nunca stg/prd).
  if (permitirDebil?.trim().toLowerCase() === 'true') return valor
  if (valor.length < LARGO_MINIMO_TOKEN || /^change-?me/i.test(valor)) return undefined
  return valor
}

// Hosts del stack local (CLI de Supabase / Docker). `kong` es el gateway interno también en STG y PRD (ver `protocolo.ts`), así
// que NO delata un entorno productivo: solo un host público (o una marca explícita de entorno) lo hace.
const HOSTS_LOCALES = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|kong|host\.docker\.internal|supabase_kong_.*|.*\.local|.*\.localhost)$/i
const ENTORNOS_PRODUCTIVOS = /^(prod|prd|production|produccion|producción|stg|stage|staging)$/i

export function esEntornoProductivo(leer: (clave: string) => string | undefined): boolean {
  for (const clave of ['ENVIRONMENT', 'APP_ENV', 'ENTORNO']) {
    if (ENTORNOS_PRODUCTIVOS.test((leer(clave) ?? '').trim())) return true
  }
  for (const clave of ['SUPABASE_URL', 'API_EXTERNAL_URL', 'SUPABASE_PUBLIC_URL']) {
    const valor = leer(clave)?.trim()
    if (!valor) continue
    try {
      if (!HOSTS_LOCALES.test(new URL(valor).hostname)) return true
    } catch {
      // Una URL ilegible no prueba nada.
    }
  }
  return false
}

// Valor de `AVISOS_PERMITIR_TOKEN_DEBIL` que realmente se aplica: la bandera solo vale en local. Si el entorno es productivo
// se IGNORA (y se avisa sin datos: ni el token ni la URL salen en el log).
export function permitirTokenDebil(leer: (clave: string) => string | undefined, avisar: (texto: string) => void = console.warn): string | undefined {
  const pedido = leer('AVISOS_PERMITIR_TOKEN_DEBIL')
  if (pedido?.trim().toLowerCase() !== 'true') return pedido
  if (!esEntornoProductivo(leer)) return pedido
  avisar('AVISOS_PERMITIR_TOKEN_DEBIL ignorada: el entorno no es local, se exige un token fuerte.')
  return undefined
}

// Comparación en tiempo constante del token recibido con el esperado. Se comparan los SHA-256 de ambos (siempre 32 bytes),
// así NO se corta por longitud antes de comparar y el tiempo no revela el largo del token. Falla cerrado sin esperado o sin
// recibido (vacío o ausente).
export function tokenValido(esperado: string | undefined, recibido: string | null | undefined): boolean {
  if (!esperado || !recibido) return false
  const hash = (texto: string) => createHash('sha256').update(texto, 'utf8').digest()
  return timingSafeEqual(hash(esperado), hash(recibido))
}
