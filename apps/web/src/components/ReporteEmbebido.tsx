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

type ReporteEmbebidoProps = {
  reporteId: string
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
export function ReporteEmbebido({ reporteId }: ReporteEmbebidoProps) {
  const mountPointRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [alto, setAlto] = useState(ALTO_INICIAL)

  useEffect(() => {
    let cancelled = false
    let intervalo: ReturnType<typeof setInterval> | undefined

    async function montar() {
      const { data: sesion } = await supabaseClient.auth.getSession()
      const accessToken = sesion.session?.access_token

      if (!accessToken) {
        if (!cancelled) {
          setError(MENSAJE_NO_DISPONIBLE)
        }
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
        setError(MENSAJE_NO_DISPONIBLE)
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
          dashboardUiConfig: { hideTitle: true },
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
        if (!cancelled) {
          setError(MENSAJE_NO_DISPONIBLE)
        }
      }
    }

    montar()

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
