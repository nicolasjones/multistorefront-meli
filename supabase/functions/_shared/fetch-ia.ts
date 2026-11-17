// `fetch` hacia el proveedor de IA con tope de espera. Sin él, un proveedor colgado ocupa el isolate hasta el límite
// de la plataforma y la política de `limiteSegundos` (que solo se validaba antes de llamar) no se cumple.
// Sin imports de Deno: se prueba con `node --test` (fetch-ia.test.ts).
type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export function fetchConTimeout(limiteSegundos: number, base: FetchLike = fetch as unknown as FetchLike) {
  const segundos = Number.isFinite(limiteSegundos) && limiteSegundos > 0 ? Math.min(limiteSegundos, 90) : 60
  return (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) =>
    base(url, { ...init, signal: AbortSignal.timeout(segundos * 1000) })
}
