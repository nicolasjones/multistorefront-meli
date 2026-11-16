import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { DetalleActividad, ValoresActividad } from '../lib/actividad'

type FilaDetalle = {
  id: string
  creado_en: string
  tipo: string
  empresa_id: string | null
  empresa_nombre: string | null
  actor_id: string | null
  actor_nombre: string | null
  detalle: string
  sensible: boolean
  valor_anterior: ValoresActividad | null
  valor_nuevo: ValoresActividad | null
}

// Detalle de un evento sobre `obtener_detalle_actividad` (security invoker: la RLS de `registro_actividad` decide).
// Solo consulta. «Última petición gana» si cambia el evento con una carga en vuelo. Cero filas = el evento ya no
// está disponible (otra organización o sin permiso).
export function useDetalleActividad(eventoId: string | null) {
  const [detalle, setDetalle] = useState<DetalleActividad | null>(null)
  const [cargando, setCargando] = useState(eventoId !== null)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    if (eventoId === null) {
      setDetalle(null)
      setCargando(false)
      setHayError(false)
      return
    }
    setCargando(true)
    let resultado: { data: FilaDetalle[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('obtener_detalle_actividad', { p_id: eventoId })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    const { data, error } = resultado
    setHayError(Boolean(error))
    const fila = error ? undefined : data?.[0]
    setDetalle(
      fila
        ? {
            id: fila.id,
            creadoEn: fila.creado_en,
            tipo: fila.tipo,
            empresaId: fila.empresa_id,
            empresaNombre: fila.empresa_nombre,
            actorId: fila.actor_id,
            actorNombre: fila.actor_nombre,
            detalle: fila.detalle,
            sensible: fila.sensible,
            valorAnterior: fila.valor_anterior,
            valorNuevo: fila.valor_nuevo,
          }
        : null,
    )
    setCargando(false)
  }, [eventoId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { detalle, isLoading: cargando, isError: hayError, refetch: cargar }
}
