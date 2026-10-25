import { useEffect, useRef, useState } from 'react'
import { Alert, Box } from '@mui/material'
import { embedDashboard } from '@superset-ui/embedded-sdk'
import { supabaseClient } from '../lib/supabase'

const MENSAJE_NO_DISPONIBLE = 'Analítica no disponible en este momento.'

// Alto mientras no sabemos todavía el real (primer render, o si
// getScrollSize nunca contesta) y piso mínimo para no colapsar el iframe
// si un reporte reporta un alto ridículamente chico.
const ALTO_INICIAL = 600
const ALTO_MINIMO = 300
const INTERVALO_RECHEQUEO_MS = 2000

export type MotivoFalloReporte = 'prohibido' | 'no_disponible'

type ReporteEmbebidoProps = {
  reporteId: string
  // Si el que lo usa maneja el error (p. ej. Rentabilidad: acceso restringido ante 403 y `Reintentar`),
  // recibe el motivo y el componente no dibuja su propio aviso. Sin esta prop, el comportamiento de
  // Analítica no cambia: el mensaje de no disponibilidad.
  alFallar?: (motivo: MotivoFalloReporte) => void
  // Parámetros de URL del embebido (p. ej. `native_filters` para preseleccionar un filtro nativo). Se leen
  // al montar: para cambiarlos hay que remontar el componente (`key`), como con `reporteId`.
  urlParams?: Record<string, string>
}

// La Edge Function responde 403 cuando el usuario no tiene la sección del reporte (F-REN-01, FR-007).
// En supabase-js el `FunctionsHttpError` trae la respuesta en `context`.
function esProhibido(error: unknown): boolean {
  const contexto = (error as { context?: { status?: number } } | null)?.context
  return contexto?.status === 403
}

// Pide el guest token a la Edge Function (contracts/acceso-reporte.md) y
// monta el dashboard con el SDK oficial de Superset. El único fallback
// visible, tanto si la función responde 503 como si el propio SDK falla al
// montar, es el mensaje de no disponibilidad (FR-015) — sin detalle
// técnico, sin reintento automático (Clarifications).
//
// Quien renderiza este componente debe pasarle `key={reporteId}` (ver
// pages/analitica/list.tsx) para que cambiar de reporte remonte una
// instancia nueva en vez de reutilizar el estado de la anterior — así el
// efecto nunca necesita resetear `error` de forma síncrona al arrancar.
export function ReporteEmbebido({ reporteId, alFallar, urlParams }: ReporteEmbebidoProps) {
  const mountPointRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [alto, setAlto] = useState(ALTO_INICIAL)
  // Último callback sin re-disparar el efecto de montaje cuando el padre lo recrea en cada render.
  const alFallarRef = useRef(alFallar)
  const urlParamsRef = useRef(urlParams)
  useEffect(() => {
    alFallarRef.current = alFallar
    urlParamsRef.current = urlParams
  })

  useEffect(() => {
    let cancelled = false
    let intervalo: ReturnType<typeof setInterval> | undefined

    function fallar(motivo: MotivoFalloReporte) {
      if (cancelled) {
        return
      }
      if (alFallarRef.current) {
        alFallarRef.current(motivo)
        return
      }
      setError(MENSAJE_NO_DISPONIBLE)
    }

    async function montar() {
      const { data: sesion } = await supabaseClient.auth.getSession()
      const accessToken = sesion.session?.access_token

      if (!accessToken) {
        fallar('no_disponible')
        return
      }

      const { data, error: fnError } = await supabaseClient.functions.invoke(
        'emitir-acceso-reporte',
        { body: { reporte_id: reporteId } },
      )

      if (cancelled) {
        return
      }

      if (fnError || !data?.guest_token) {
        fallar(esProhibido(fnError) ? 'prohibido' : 'no_disponible')
        return
      }

      if (!mountPointRef.current) {
        return
      }

      try {
        const dashboard = await embedDashboard({
          id: data.dashboard_uuid,
          supersetDomain: data.superset_url,
          mountPoint: mountPointRef.current,
          fetchGuestToken: () => Promise.resolve(data.guest_token),
          dashboardUiConfig: { hideTitle: true, urlParams: urlParamsRef.current },
        })

        // El dashboard adentro del iframe puede medir cualquier cosa (no
        // hay forma de saberlo de antemano — depende de lo que arme quien
        // lo diseña en Superset), así que el alto se ajusta a lo que el
        // propio SDK reporta (getScrollSize, vía postMessage) en vez de un
        // valor fijo. Se re-chequea cada pocos segundos porque el alto real
        // puede cambiar sin remontar el iframe (filtros, tabs).
        const actualizarAlto = async () => {
          try {
            const size = await dashboard?.getScrollSize?.()
            if (!cancelled && size?.height) {
              setAlto(Math.max(size.height, ALTO_MINIMO))
            }
          } catch {
            // Si el SDK todavía no puede contestar (por ejemplo, un
            // instante justo después de montar), se mantiene el alto
            // vigente — no es un error visible para quien mira el reporte.
          }
        }

        await actualizarAlto()
        intervalo = setInterval(actualizarAlto, INTERVALO_RECHEQUEO_MS)
      } catch {
        fallar('no_disponible')
      }
    }

    montar().catch(() => fallar('no_disponible'))

    return () => {
      cancelled = true
      if (intervalo) {
        clearInterval(intervalo)
      }
    }
  }, [reporteId])

  if (error) {
    return <Alert severity="warning">{error}</Alert>
  }

  return (
    <Box
      ref={mountPointRef}
      sx={{
        width: '100%',
        height: alto,
        transition: 'height 0.2s ease',
        // El SDK inyecta el <iframe> directo, sin estilos propios más allá
        // de background:transparent — el borde por default del navegador
        // (y el hueco de unos px debajo, típico de un elemento inline como
        // <iframe>) es lo que se ve "feo"; display:block lo saca.
        '& iframe': {
          border: 'none',
          display: 'block',
          width: '100%',
          height: '100%',
        },
      }}
    />
  )
}
