// IP del cliente de un pedido anónimo, para un cupo por IP (MSF-980). Función pura (sin Deno ni Supabase) probada con `node --test` (ip-cliente.test.ts).
//
// Se lee `x-forwarded-for` igual que la base (`private.ip_cliente_publica`): el último valor de la cadena menos los saltos de proxy de CONFIANZA (que agregan SU
// IP al final). El valor que pone el proxy más cercano no lo puede falsificar quien llama; los anteriores sí, por eso no se toma el primero. Sin cabecera o con
// un valor vacío: `sin-ip` (un único cupo compartido: falla cerrado, nunca abierto). La IP solo viaja a la RPC de cupo, que guarda su HMAC; nunca se registra.
export const IP_MAXIMA = 64
export const SIN_IP = 'sin-ip'
export const SALTOS_MAXIMOS = 10

// Saltos de proxy de confianza desde el entorno: un entero entre 0 y SALTOS_MAXIMOS; cualquier otra cosa (ausente, negativo, decimal, texto) vale 0.
export function saltosDeProxy(valor: string | undefined): number {
  const n = Number(valor)
  return valor !== undefined && valor.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= SALTOS_MAXIMOS ? n : 0
}

export function ipDelCliente(encabezados: Pick<Headers, 'get'>, saltos: number): string {
  const cadena = (encabezados.get('x-forwarded-for') ?? '').split(',').map((parte) => parte.trim())
  const indice = Math.max(0, cadena.length - 1 - Math.max(0, Math.trunc(saltos)))
  return cadena[indice]?.slice(0, IP_MAXIMA) || SIN_IP
}
