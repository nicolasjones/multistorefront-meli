import { useCallback, useEffect, useRef, useState } from 'react'
import { leerConteoVentas, type RangoFechas } from '../lib/ventas-reportes'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Conteo de ventas del período (F-VTA-22, FR-005, SC-003): la pantalla «Reportes de ventas» lo usa
// para distinguir «no hay ventas en ese período» (estado vacío) de un tablero que sí tiene datos.
// «Última petición gana»: si cambia el período o la empresa mientras viaja una consulta, la respuesta
// vieja se descarta. Un error no se traga: queda en `hayError` y la pantalla sigue mostrando el
// tablero (el conteo es un dato auxiliar, no la fuente del reporte).
export function useConteoVentasReporte({
  rango,
  empresaId,
  habilitado = true,
}: {
  rango: RangoFechas
  empresaId: string | null
  habilitado?: boolean
}) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [conteo, setConteo] = useState<number | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const resultado = await leerConteoVentas(supabaseClient, { rango, empresaId })
      if (peticion === ultimaPeticion.current) setConteo(resultado)
    } catch (error) {
      console.error('No pudimos contar las ventas del período.', error)
      if (peticion === ultimaPeticion.current) {
        setConteo(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [empresaId, rango.desde, rango.hasta])

  useEffect(() => {
    // Nunca muestra el conteo del período anterior mientras llega el nuevo.
    setConteo(null)
    if (habilitado) void cargar()
  }, [cargar, habilitado, organizacionId])

  return { conteo, hayError, isLoading: habilitado && cargando, recargar: cargar }
}
