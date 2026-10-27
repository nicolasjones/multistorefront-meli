import { useCallback, useEffect, useRef, useState } from 'react'
import { leerConteoVentas, type RangoFechas } from '../lib/ventas-reportes'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

type ConteoVigente = {
  // Clave de los filtros con los que se contó (período, empresa y organización): si no coincide con
  // la clave vigente, el conteo es viejo y no se muestra.
  clave: string
  conteo: number | null
  hayError: boolean
}

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
  const { desde, hasta } = rango
  // La clave del pedido: cambia con el período, la empresa o la organización.
  const clave = `${organizacionId ?? ''}|${desde}|${hasta}|${empresaId ?? ''}`
  const [resultado, setResultado] = useState<ConteoVigente | null>(null)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const conteo = await leerConteoVentas(supabaseClient, { rango: { desde, hasta }, empresaId })
      if (peticion === ultimaPeticion.current) setResultado({ clave, conteo, hayError: false })
    } catch (error) {
      console.error('No pudimos contar las ventas del período.', error)
      if (peticion === ultimaPeticion.current) setResultado({ clave, conteo: null, hayError: true })
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [clave, desde, empresaId, hasta])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [cargar, habilitado])

  // El conteo de otra clave (el del período o la empresa anteriores) se invalida EN EL MISMO render,
  // no en un efecto posterior: si se invalidara después, el tablero se montaría con el conteo viejo,
  // pediría el token del guest y recién entonces se desmontaría al llegar el conteo nuevo (dos pedidos
  // de token por cada cambio de filtro).
  const vigente = resultado?.clave === clave ? resultado : null

  return {
    conteo: vigente?.conteo ?? null,
    hayError: vigente?.hayError ?? false,
    isLoading: habilitado && (cargando || vigente === null),
    recargar: cargar,
  }
}
