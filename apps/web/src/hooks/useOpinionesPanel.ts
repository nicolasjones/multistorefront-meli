import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONTADORES_VACIOS,
  type ContadoresOpiniones,
  type CursorOpiniones,
  type FiltroEstadoOpinion,
  type OpinionPanel,
  esSinPermisoOpiniones,
  listarOpiniones,
} from '../lib/opiniones'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Listado de opiniones por tandas con cursor (creada_en, id) y contadores del ámbito de la tienda. Cambiar el estado, la
// tienda o la organización reinicia la lista y el cursor (nada de lo anterior se conserva); «última petición gana».
// `recargar` vuelve a pedir desde la primera tanda (después de moderar).
export function useOpinionesPanel({ estado, empresaId }: { estado: FiltroEstadoOpinion; empresaId: string | null }) {
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const [filas, setFilas] = useState<OpinionPanel[]>([])
  const [contadores, setContadores] = useState<ContadoresOpiniones>(CONTADORES_VACIOS)
  const [siguiente, setSiguiente] = useState<CursorOpiniones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [hayError, setHayError] = useState(false)
  const [errorTanda, setErrorTanda] = useState(false)
  const [sinPermiso, setSinPermiso] = useState(false)
  const [version, setVersion] = useState(0)
  const peticion = useRef(0)

  useEffect(() => {
    const esta = ++peticion.current
    // Reinicio: lo anterior (filas, cursor, error) no se mezcla con el nuevo ámbito.
    setCargando(true)
    setCargandoMas(false)
    setHayError(false)
    setErrorTanda(false)
    setFilas([])
    setSiguiente(null)
    void listarOpiniones({ estado, empresaId })
      .then((tanda) => {
        if (esta !== peticion.current) return
        setFilas(tanda.filas)
        setContadores(tanda.contadores)
        setSiguiente(tanda.siguiente)
        setSinPermiso(false)
        setCargando(false)
      })
      .catch((error: unknown) => {
        if (esta !== peticion.current) return
        console.error('No pudimos listar las opiniones.', (error as { code?: string })?.code ?? 'sin código')
        setSinPermiso(esSinPermisoOpiniones(error))
        setHayError(true)
        setCargando(false)
      })
  }, [estado, empresaId, organizacionId, version])

  const cargarMas = useCallback(() => {
    if (!siguiente || cargandoMas || cargando) return
    const esta = ++peticion.current
    setCargandoMas(true)
    setErrorTanda(false)
    void listarOpiniones({ estado, empresaId, desde: siguiente })
      .then((tanda) => {
        if (esta !== peticion.current) return
        setFilas((previas) => {
          const vistos = new Set(previas.map((f) => f.id))
          return [...previas, ...tanda.filas.filter((f) => !vistos.has(f.id))]
        })
        setContadores(tanda.contadores)
        setSiguiente(tanda.siguiente)
        setCargandoMas(false)
      })
      .catch((error: unknown) => {
        if (esta !== peticion.current) return
        console.error('No pudimos cargar más opiniones.', (error as { code?: string })?.code ?? 'sin código')
        setErrorTanda(true)
        setCargandoMas(false)
      })
  }, [siguiente, cargandoMas, cargando, estado, empresaId])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  return { filas, contadores, hayMas: siguiente !== null, cargando, cargandoMas, hayError, errorTanda, sinPermiso, cargarMas, recargar }
}
