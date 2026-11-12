// Datos de la pantalla «API» (F-API-01, FR-001, FR-002, FR-008, FR-010, FR-013, FR-014).
//
// Las cuatro tablas son de la ORGANIZACIÓN (no de una empresa): la RLS ya
// filtra por `private.es_administrador_de(organizacion_id)`, así que la
// pantalla no filtra ni reacciona a la empresa activa. Solo se piden las
// columnas con permiso de lectura: el hash de la clave y la referencia al
// secreto de Vault nunca llegan al navegador.
import { useCallback, useEffect, useState } from 'react'
import { supabaseClient } from '../../lib/supabase'

export type Clave = {
  id: string
  nombre: string
  prefijo: string
  alcances: string[]
  limite_por_minuto: number
  creada_en: string
  vence_en: string | null
  revocada_en: string | null
  ultimo_uso_en: string | null
}

export type Suscripcion = {
  id: string
  url: string
  tipos: string[]
  activa: boolean
  creada_en: string
  actualizada_en: string
  /** Hasta cuándo vale el secreto anterior tras una rotación (gracia de 24 h); nulo si no hay rotación en curso. */
  secreto_anterior_vence_en: string | null
}

export type Entrega = {
  id: string
  evento_id: string
  suscripcion_id: string
  estado: 'pendiente' | 'reclamada' | 'completada' | 'agotada'
  intentos: number
  ultimo_estado_http: number | null
  ultimo_error_sanitizado: string | null
  creada_en: string
  actualizada_en: string
}

export type Llamada = {
  id: string
  metodo: string
  ruta: string
  version: string
  estado_http: number
  duracion_ms: number | null
  creada_en: string
}

export const ALCANCES = ['productos', 'stock', 'precios', 'ventas'] as const

export const TIPOS_EVENTO = ['stock.actualizado', 'precio.actualizado', 'venta.registrada'] as const

/**
 * Lee una tabla de la API. `columnas` va explícito porque los permisos son por
 * columna: pedir `*` sería un error de permisos.
 */
export function useApiTabla<T>(tabla: string, columnas: string, orden: string) {
  const [estado, setEstado] = useState<{ filas: T[] | null; hayError: boolean }>({ filas: null, hayError: false })
  const [carga, setCarga] = useState(0)

  useEffect(() => {
    let cancelado = false
    supabaseClient
      .from(tabla)
      .select(columnas)
      .order(orden, { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setEstado({ filas: null, hayError: true })
          return
        }
        setEstado({ filas: (data ?? []) as T[], hayError: false })
      })
    return () => {
      cancelado = true
    }
  }, [tabla, columnas, orden, carga])

  const recargar = useCallback(() => setCarga((valor) => valor + 1), [])

  return { filas: estado.filas, hayError: estado.hayError, recargar }
}
