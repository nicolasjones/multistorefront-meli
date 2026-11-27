import { useEffect, useState } from 'react'
import { listarEstadosConsulta } from '../lib/listas'
import type { OpcionEstadoConsulta } from '../lib/consultas'
import { useContextoPanel } from './useContextoPanel'

// Estados de consulta de la organización (MSF-595) para mostrar el nombre de cada consulta y para elegir. Solo lectura:
// la lista se edita en «Listas configurables». `null` = todavía sin lista (o la carga falló: la pantalla cae a los tres
// de base, que existen siempre). Cada resultado queda atado a su organización: otra organización activa descarta lo anterior.
export function useOpcionesEstadoConsulta(): { opciones: OpcionEstadoConsulta[] | null; hayError: boolean } {
  const { contexto } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const [lectura, setLectura] = useState<{ organizacionId: string | null; opciones: OpcionEstadoConsulta[] | null; hayError: boolean } | null>(null)

  useEffect(() => {
    let vigente = true
    listarEstadosConsulta().then(
      (estados) => {
        if (vigente) setLectura({
          organizacionId,
          opciones: estados.map((estado) => ({ clave: estado.clave, nombre: estado.nombre, activo: estado.activo })),
          hayError: false,
        })
      },
      (error: unknown) => {
        console.error('No pudimos cargar los estados de consulta.', error instanceof Error ? error.message : error)
        if (vigente) setLectura({ organizacionId, opciones: null, hayError: true })
      },
    )
    return () => { vigente = false }
  }, [organizacionId])

  return lectura !== null && lectura.organizacionId === organizacionId
    ? { opciones: lectura.opciones, hayError: lectura.hayError }
    : { opciones: null, hayError: false }
}
