// Utilidad SOLO de pruebas (`node --test`): captura lo que el código imprime con `console.error`, `console.warn`, `console.log` e `console.info`
// y lo devuelve como líneas de texto (objetos con `util.inspect`, para ver también lo que va dentro de un objeto de log). Sin imports de Deno.
// Ninguna función de producción la importa.
import { inspect } from 'node:util'

export async function capturarLog<T>(fn: () => Promise<T> | T): Promise<{ resultado: T; lineas: string[] }> {
  const metodos = ['error', 'warn', 'log', 'info'] as const
  const originales = metodos.map((m) => console[m])
  const lineas: string[] = []
  for (const m of metodos) console[m] = (...args: unknown[]) => { lineas.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' ')) }
  try {
    return { resultado: await fn(), lineas }
  } finally {
    metodos.forEach((m, i) => { console[m] = originales[i] })
  }
}

// Error hostil de red: mensaje, `cause`, `stack` y URL con la clave `sk-secreta` (lo que haría un cliente SMTP o `fetch` real al fallar).
export function errorHostil(): Error {
  const error = new Error('connect ECONNREFUSED smtp.interno.example.com:465 user=ana@example.com pass=sk-secreta https://x.example.com/?k=sk-secreta', {
    cause: new Error('Bearer sk-secreta'),
  })
  error.stack = `Error: sk-secreta\n    at https://x.example.com/?k=sk-secreta`
  return error
}

// Error de la base (`{ code, message }` de PostgREST) con una credencial y una URL en el mensaje, en los formatos que `redactarCredenciales` cubre
// (clave `sk-` de 10+ caracteres, URL). Un secreto sin formato reconocible NO se redacta en un mensaje de la base (límite documentado en log-seguro.ts).
export const ERROR_BASE_HOSTIL = { code: '42501', message: 'permiso denegado https://db.example.com/?k=sk-secreta-0123456789 sk-secreta-0123456789' }
