import type { Mock } from 'vitest'
import type { Notificacion } from './notificaciones'

// Doble compartido de las pruebas de la campanita: la RPC de Supabase se simula por nombre.

export function notificacion(n: number, extra: Partial<Notificacion> = {}): Notificacion {
  return {
    id: `n-${n}`,
    tipo_nombre: 'Consulta nueva',
    datos: { Nombre: `Persona ${n}`, Producto: 'Remera' },
    creado_en: new Date(Date.now() - n * 3_600_000).toISOString(),
    leido_en: null,
    ...extra,
  }
}

export function simularRpc(rpc: Mock, opciones: { sinLeer?: number; items?: Notificacion[]; total?: number } = {}) {
  const items = opciones.items ?? []
  rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'contar_notificaciones_sin_leer') return { data: opciones.sinLeer ?? 0, error: null }
    if (nombre === 'listar_notificaciones') return { data: { total: opciones.total ?? items.length, items }, error: null }
    if (nombre === 'marcar_notificaciones_leidas') return { data: 1, error: null }
    return { data: null, error: null }
  })
}
