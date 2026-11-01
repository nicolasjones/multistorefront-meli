// Esquema de los enlaces a las tiendas (`redirectTo`). Módulo aparte, sin `Deno` ni imports remotos, para poder
// probarlo con `node --test`.
//
// Regla (MSF-726): las tiendas viven en https. `http` solo con la señal explícita `ALLOW_HTTP_REDIRECT=true`
// (desarrollo local). El host de `SUPABASE_URL` NO decide el esquema: `kong` es el gateway interno de Docker
// también en STG y PRD, así que derivarlo de ahí mandaba los enlaces en claro a producción.
export type Entorno = {
  // Señal explícita de desarrollo local. Solo el valor `true` habilita `http`.
  ALLOW_HTTP_REDIRECT?: string | undefined
  // Se recibe a propósito para dejar constancia de que NO interviene en la decisión (el caso de STG/PRD es
  // `http://kong:8000` y el esquema tiene que seguir siendo https).
  SUPABASE_URL?: string | undefined
}

export const protocoloTienda = (entorno: Entorno): 'https' | 'http' =>
  entorno.ALLOW_HTTP_REDIRECT?.trim().toLowerCase() === 'true' ? 'http' : 'https'
