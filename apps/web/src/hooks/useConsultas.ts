import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  contarConsultasNuevas,
  leerConsulta,
  listarConsultas,
  listarResponsables,
  revisionConsultas,
  suscribirCambioConsultas,
  type Consulta,
  type FiltrosConsultas,
  type Responsable,
} from '../lib/consultas'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Todas las lecturas de la bandeja comparten dos reglas:
//  * «Última petición gana»: una respuesta vieja no pisa a la nueva.
//  * Cada resultado queda atado a su ÁMBITO (organización + empresa): si el ámbito cambia (otra
//    empresa activa en la barra superior, FR-008), lo que había se descarta de inmediato y
//    nunca se muestran filas, totales ni contadores de la empresa anterior. Cambiar de página o
//    de filtro dentro del mismo ámbito conserva las filas mientras llega lo nuevo.

function useRevisionConsultas(): number {
  return useSyncExternalStore(suscribirCambioConsultas, revisionConsultas, revisionConsultas)
}

type Lectura<T> = { ambito: string; datos: T } | { ambito: string; error: true }

export function useBandejaConsultas(filtros: FiltrosConsultas, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const ambito = `${organizacionActiva?.id ?? ''}|${filtros.empresaId ?? 'todas'}`
  const revision = useRevisionConsultas()
  const [lectura, setLectura] = useState<Lectura<{ filas: Consulta[]; total: number }> | null>(null)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)
  const { empresaId, estado, texto, desde, hasta, pagina, tamano } = filtros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura<{ filas: Consulta[]; total: number }>
    try {
      resultado = { ambito, datos: await listarConsultas({ empresaId, estado, texto, desde, hasta, pagina, tamano }) }
    } catch (error) {
      console.error('No se pudo cargar la bandeja de consultas', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
    // `revision` solo dispara la recarga tras guardar una consulta.
  }, [ambito, empresaId, estado, texto, desde, hasta, pagina, tamano, revision])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  const datos = vigente && 'datos' in lectura ? lectura.datos : null
  return {
    consultas: datos?.filas ?? [],
    total: datos?.total ?? 0,
    isLoading: !habilitado || !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}

// Una consulta por id para el detalle (enlace `?consulta=<id>`). Siempre se lee fresca al abrir:
// su `updated_at` es el sello del bloqueo optimista. `noEncontrada` cubre inexistente y sin
// acceso por igual. Se relee además cuando cambia una consulta (guardar o registrar una
// respuesta): si el sello del detalle quedara viejo, la acción siguiente chocaría con el control
// de concurrencia y obligaría a recargar, con lo que se pierden los cambios sin guardar (MSF-698).
export function useConsulta(id: string | null) {
  const { organizacionActiva } = useOrganizacionActiva()
  const clave = `${organizacionActiva?.id ?? ''}|${id ?? ''}`
  const revision = useRevisionConsultas()
  const [lectura, setLectura] = useState<Lectura<Consulta | null> | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!id) return
    const peticion = ++ultimaPeticion.current
    let resultado: Lectura<Consulta | null>
    try {
      resultado = { ambito: clave, datos: await leerConsulta(id) }
    } catch (error) {
      console.error('No se pudo cargar la consulta', error instanceof Error ? error.message : error)
      resultado = { ambito: clave, error: true }
    }
    if (peticion === ultimaPeticion.current) setLectura(resultado)
    // `revision` solo dispara la relectura tras cambiar una consulta.
  }, [id, clave, revision])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = id !== null && lectura !== null && lectura.ambito === clave
  const datos = vigente && 'datos' in lectura ? lectura.datos : null
  return {
    consulta: datos,
    isLoading: id !== null && !vigente,
    isError: vigente && 'error' in lectura,
    noEncontrada: vigente && 'datos' in lectura && lectura.datos === null,
    refetch: cargar,
  }
}

// Personas a quienes se puede asignar una consulta de la empresa (RPC `responsables_consultas`).
export function useResponsablesConsultas(empresaId: string | null) {
  const { organizacionActiva } = useOrganizacionActiva()
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? ''}`
  const [lectura, setLectura] = useState<Lectura<Responsable[]> | null>(null)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    if (!empresaId) return
    const peticion = ++ultimaPeticion.current
    listarResponsables(empresaId).then(
      (responsables) => {
        if (peticion === ultimaPeticion.current) setLectura({ ambito, datos: responsables })
      },
      (error: unknown) => {
        console.error('No se pudieron cargar los responsables', error instanceof Error ? error.message : error)
        if (peticion === ultimaPeticion.current) setLectura({ ambito, error: true })
      },
    )
  }, [empresaId, ambito])

  const vigente = empresaId !== null && lectura !== null && lectura.ambito === ambito
  return {
    responsables: vigente && 'datos' in lectura ? lectura.datos : [],
    isLoading: empresaId !== null && !vigente,
    isError: vigente && 'error' in lectura,
  }
}

// Consultas «nuevas» visibles (contador del menú y chip «Nuevas (n)»). `total` es null mientras no
// hay un valor vigente para el ámbito (nunca el de otra empresa). Se relee al guardar una consulta
// y al volver a enfocar la ventana: una consulta que llega mientras se trabaja se ve al volver.
export function useConsultasNuevas(empresaId: string | null, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? 'todas'}`
  const revision = useRevisionConsultas()
  const [enfoques, setEnfoques] = useState(0)
  const [lectura, setLectura] = useState<Lectura<number> | null>(null)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') setEnfoques((n) => n + 1)
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [])

  useEffect(() => {
    if (!habilitado) return
    const peticion = ++ultimaPeticion.current
    contarConsultasNuevas(empresaId).then(
      (total) => {
        if (peticion === ultimaPeticion.current) setLectura({ ambito, datos: total })
      },
      (error: unknown) => {
        console.error('No se pudo contar las consultas nuevas', error instanceof Error ? error.message : error)
        if (peticion === ultimaPeticion.current) setLectura({ ambito, error: true })
      },
    )
    // `revision` y `enfoques` solo disparan la relectura.
  }, [habilitado, empresaId, ambito, revision, enfoques])

  const vigente = lectura !== null && lectura.ambito === ambito
  return { total: vigente && 'datos' in lectura ? lectura.datos : null }
}
