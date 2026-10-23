import { useEffect, useRef } from 'react'
import { useContextoPanel } from '../hooks/useContextoPanel'
import { supabaseClient } from './supabase'

// Ventana de agrupación: una ráfaga de avisos (p. ej. 20 salidas seguidas) dispara un solo refresco.
export const ESPERA_AGRUPAR_MS = 300

// Stock actual en vivo (F-STK-01, FR-010; F-STK-14, FR-011): escucha los cambios de
// `dominio.existencias` y `dominio.existencias_deposito` de la organización activa (Supabase
// Realtime, que aplica la RLS de cada suscriptor) y avisa con `alCambiar`, agrupando ráfagas. Se limpia al desmontar o cambiar de organización. Si la conexión
// falla no rompe la pantalla: el listado sigue disponible por consulta normal.
export function useExistenciasRealtime(alCambiar: () => void, esperaMs = ESPERA_AGRUPAR_MS) {
  const { contexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const alCambiarRef = useRef(alCambiar)

  useEffect(() => {
    alCambiarRef.current = alCambiar
  }, [alCambiar])

  useEffect(() => {
    if (!organizacionId) return
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const avisar = () => {
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(() => {
        temporizador = null
        alCambiarRef.current()
      }, esperaMs)
    }

    let canal: ReturnType<typeof supabaseClient.channel> | null = null
    try {
      canal = supabaseClient
        .channel(`existencias:${organizacionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'dominio', table: 'existencias', filter: `organizacion_id=eq.${organizacionId}` },
          avisar,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'dominio', table: 'existencias_deposito', filter: `organizacion_id=eq.${organizacionId}` },
          avisar,
        )
        .subscribe((estado, error) => {
          if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
            // Sin vida en vivo el listado sigue usable; queda en consola.
            console.warn('No pudimos conectar el stock en vivo.', error)
          }
        })
    } catch (error) {
      console.warn('No pudimos conectar el stock en vivo.', error)
    }

    return () => {
      if (temporizador) clearTimeout(temporizador)
      if (canal) {
        void supabaseClient.removeChannel(canal).catch((error: unknown) => {
          console.warn('No pudimos cerrar el canal de stock en vivo.', error)
        })
      }
    }
  }, [organizacionId, esperaMs])
}
