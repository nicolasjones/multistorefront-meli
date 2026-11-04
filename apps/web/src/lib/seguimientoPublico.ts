// Consulta pública de estado (F-SVC-22, FR-041/FR-045). Llama a la Edge Function `consultar-estado-reparacion`
// SIN sesión: solo con la clave pública (anon) para pasar el gateway. Nunca lanza: traduce 404/429/red a un
// resultado que la página sabe mostrar.

export type PuntoLineaDeTiempo = { estado: string; fecha: string }
export type EstadoPublico = {
  codigo: string
  tienda: string
  equipo: string
  modelo: string
  estado: { nombre: string; descripcion: string }
  entrega_prevista: string | null
  linea_de_tiempo: PuntoLineaDeTiempo[]
}

export type ResultadoSeguimiento =
  | { tipo: 'ok'; estado: EstadoPublico }
  | { tipo: 'no_encontrada' }
  | { tipo: 'demasiadas'; reintentarEn: number | null }
  | { tipo: 'error' }

const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')

// La página nunca se rompe si el formato no es el esperado: solo toma la lista blanca y descarta el resto.
export function aEstadoPublico(bruto: unknown): EstadoPublico {
  const o = (bruto ?? {}) as Record<string, unknown>
  const estado = (o.estado ?? {}) as Record<string, unknown>
  const linea = Array.isArray(o.linea_de_tiempo) ? (o.linea_de_tiempo as Record<string, unknown>[]) : []
  return {
    codigo: texto(o.codigo),
    tienda: texto(o.tienda),
    equipo: texto(o.equipo),
    modelo: texto(o.modelo),
    estado: { nombre: texto(estado.nombre), descripcion: texto(estado.descripcion) },
    entrega_prevista: typeof o.entrega_prevista === 'string' ? o.entrega_prevista : null,
    linea_de_tiempo: linea.map((punto) => ({ estado: texto(punto?.estado), fecha: texto(punto?.fecha) })),
  }
}

export async function consultarEstadoReparacion(token: string, recurso: typeof fetch = fetch): Promise<ResultadoSeguimiento> {
  const url = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
  const clave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'missing-anon-key'
  try {
    const respuesta = await recurso(`${url}/functions/v1/consultar-estado-reparacion`, {
      method: 'POST',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', apikey: clave, Authorization: `Bearer ${clave}` },
      body: JSON.stringify({ token }),
    })
    if (respuesta.status === 404) return { tipo: 'no_encontrada' }
    if (respuesta.status === 429) {
      const segundos = Number(respuesta.headers.get('Retry-After'))
      return { tipo: 'demasiadas', reintentarEn: Number.isFinite(segundos) && segundos > 0 ? segundos : null }
    }
    if (!respuesta.ok) return { tipo: 'error' }
    return { tipo: 'ok', estado: aEstadoPublico(await respuesta.json()) }
  } catch {
    return { tipo: 'error' }
  }
}
