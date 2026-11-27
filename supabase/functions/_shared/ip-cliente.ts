// IP del cliente de un pedido anónimo, para un cupo por IP (MSF-980). Función pura (sin Deno ni Supabase) probada con `node --test` (ip-cliente.test.ts).
//
// Se lee `x-forwarded-for` igual que la base (`private.ip_de_cadena`): el valor que está `saltos` lugares antes del último de la cadena (los valores vacíos se
// descartan). El que pone el proxy más cercano no lo puede falsificar quien llama; los anteriores sí, por eso no se toma el primero. Sin cabecera, o con una
// cadena MÁS CORTA que `saltos + 1` (algún proxy no agregó su IP, así que el primer valor lo pudo escribir el cliente y elegiría su propio cupo), un valor fijo:
// `sin-ip`, un cupo compartido que falla cerrado, como en `consultar-estado-reparacion`. La IP solo viaja a la RPC de cupo, que la canonicaliza (corchetes,
// puerto, IPv6 y mapeadas) y guarda su HMAC; nunca se registra.
export const IP_MAXIMA = 64
export const SIN_IP = 'sin-ip'
export const SALTOS_MAXIMOS = 10

// Saltos de proxy de confianza desde el entorno: un entero entre 0 y SALTOS_MAXIMOS; cualquier otra cosa (ausente, negativo, decimal, texto) vale 0.
export function saltosDeProxy(valor: string | undefined): number {
  const n = Number(valor)
  return valor !== undefined && valor.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= SALTOS_MAXIMOS ? n : 0
}

// Cadena de `x-forwarded-for` sin valores vacíos.
export function cadenaProxy(encabezados: Pick<Headers, 'get'>): string[] {
  return (encabezados.get('x-forwarded-for') ?? '').split(',').map((parte) => parte.trim()).filter(Boolean)
}

export function ipDelCliente(encabezados: Pick<Headers, 'get'>, saltos: number): string {
  const cadena = cadenaProxy(encabezados)
  const n = Math.max(0, Math.trunc(saltos))
  if (cadena.length < n + 1) return SIN_IP
  return cadena[cadena.length - 1 - n]?.slice(0, IP_MAXIMA) || SIN_IP
}
