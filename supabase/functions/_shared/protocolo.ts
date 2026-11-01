// Esquema de los enlaces a las tiendas (`redirectTo`). Módulo aparte, sin `Deno` ni imports remotos,
// para poder probarlo con `node --test`.

// Las tiendas viven en https. `http` solo con la señal explícita ALLOW_HTTP_REDIRECT=true (desarrollo local):
// el host de SUPABASE_URL NO distingue entorno (`kong` es el gateway interno también en STG y PRD).
export const protocoloTienda = (permitirHttp: string | undefined): 'https' | 'http' =>
  permitirHttp?.trim().toLowerCase() === 'true' ? 'http' : 'https'
