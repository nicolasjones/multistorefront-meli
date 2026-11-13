import { useCallback, useEffect, useRef, useState } from 'react'
import {
  leerMovimientosPorProducto, TAMANO_PAGINA_MOVIMIENTOS,
  type ContextoTablero, type FiltrosMovimientos, type MovimientoProducto,
} from '../lib/inicioBloques'
import { useOrganizacionActiva } from './useOrganizacionActiva'

type Resultado = { clave: string; filas: MovimientoProducto[]; total: number; error: boolean }

// Una página del listado «Movimientos por producto» (F-INI-06), paginada en el servidor y pensada para sumarse
// con `useListadoAcumulado` (carga infinita). Cada resultado queda atado a la CLAVE de su consulta (organización,
// período, tienda, depósito, filtros, orden y página): «cargando» sale de comparar esa clave con la vigente, así
// que nunca se muestra como actual el resultado de otra consulta y no hay estado que se fije dentro de un efecto.
// «Última petición gana»: si cambia la consulta con una carga en vuelo, la respuesta vieja se descarta.
export function useMovimientosPorProducto(contexto: ContextoTablero, filtros: FiltrosMovimientos, pagina: number, habilitado = true) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const { organizacionActiva } = useOrganizacionActiva()
  const ultimaPeticion = useRef(0)
  // Último total que llegó bien: si falla una tanda siguiente se conserva (no «Mostrando 25 de 0»).
  const ultimoTotal = useRef(0)
  const { desde, hasta, empresaId, depositoId } = contexto
  const { busqueda, categoriaId, vista, orden, direccion } = filtros
  const clave = JSON.stringify([organizacionActiva?.id ?? null, desde, hasta, empresaId, depositoId, busqueda, categoriaId, vista, orden, direccion, pagina])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    let nuevo: Resultado
    try {
      const datos = await leerMovimientosPorProducto(
        { desde, hasta, empresaId, depositoId },
        { busqueda, categoriaId, vista, orden, direccion },
        pagina,
        TAMANO_PAGINA_MOVIMIENTOS,
      )
      ultimoTotal.current = datos.total
      nuevo = { clave, ...datos, error: false }
    } catch (error) {
      console.error('No pudimos cargar los movimientos por producto.', error instanceof Error ? error.message : error)
      nuevo = { clave, filas: [], total: ultimoTotal.current, error: true }
    }
    if (peticion === ultimaPeticion.current) setResultado(nuevo)
  }, [clave, desde, hasta, empresaId, depositoId, busqueda, categoriaId, vista, orden, direccion, pagina])

  useEffect(() => {
    if (habilitado) void cargar()
    else ultimaPeticion.current++
  }, [habilitado, cargar])

  const vigente = resultado !== null && resultado.clave === clave
  return {
    filas: resultado?.filas ?? [],
    total: resultado?.total ?? 0,
    isLoading: habilitado && !vigente,
    isError: vigente && resultado.error,
    // «Reintentar» vuelve a pedir la consulta actual y deja el error a la vista hasta que llegue la respuesta.
    refetch: cargar,
  }
}
