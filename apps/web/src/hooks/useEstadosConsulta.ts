import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cambiarActivoEstadoConsulta, crearEstadoConsulta, listarEstadosConsulta, mensajeDeErrorLista,
  renombrarEstadoConsulta, type EstadoConsulta,
} from '../lib/listas'

// Estados de consulta (F-CFG-01, FR-014/FR-015): lectura y escritura por RPC. Cada acción
// devuelve el mensaje de error (o null si salió bien) y recarga la lista al terminar.
export function useEstadosConsulta() {
  const [estados, setEstados] = useState<EstadoConsulta[] | null>(null)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const lista = await listarEstadosConsulta()
      if (peticion === ultimaPeticion.current) setEstados(lista)
    } catch (error) {
      console.error('No pudimos cargar los estados de consulta.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const ejecutar = useCallback(async (accion: () => Promise<void>, porDefecto: string): Promise<string | null> => {
    try {
      await accion()
    } catch (error) {
      return mensajeDeErrorLista(error, porDefecto)
    }
    await cargar()
    return null
  }, [cargar])

  const crear = useCallback(
    (nombre: string) => ejecutar(() => crearEstadoConsulta(nombre), 'No pudimos guardar el estado. Intentá de nuevo.'),
    [ejecutar],
  )
  const renombrar = useCallback(
    (id: string, nombre: string) => ejecutar(() => renombrarEstadoConsulta(id, nombre), 'No pudimos guardar el estado. Intentá de nuevo.'),
    [ejecutar],
  )
  const cambiarActivo = useCallback(
    (estado: EstadoConsulta) => ejecutar(
      () => cambiarActivoEstadoConsulta(estado.id, !estado.activo),
      `No pudimos ${estado.activo ? 'desactivar' : 'activar'} el estado. Intentá de nuevo.`,
    ),
    [ejecutar],
  )

  return { estados, hayError, recargar: cargar, crear, renombrar, cambiarActivo }
}
