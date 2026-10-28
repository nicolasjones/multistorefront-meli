import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MENSAJE_AVISO_ENCOLADO,
  MENSAJE_CLIENTE_SIN_CORREO,
  avisarClienteDeReparacion,
  clienteTieneCorreo,
  listarAvisosDeReparacion,
  mensajeDeAvisar,
  mensajeDeCargarAvisos,
  type AvisoReparacion,
} from '../lib/reparacionAvisos'

export type EstadoAvisosReparacion = {
  avisos: AvisoReparacion[]
  cargando: boolean
  errorCarga: string | null
  // `false` = el cliente no tiene correo; `null` = no se sabe todavía (decide la base al avisar).
  clienteConCorreo: boolean | null
  avisando: boolean
  errorAvisar: string | null
  // Mensaje de éxito de la última acción (null si no hay).
  aviso: string | null
  recargar: () => void
  // Pide el aviso del estado indicado (por defecto, el actual). Devuelve true si quedó encolado.
  avisar: (estadoId?: string) => Promise<boolean>
}

// Avisos al cliente de una reparación y la acción de pedirlos (F-SVC-14). Al cambiar la reparación o la empresa
// activa descarta lo cargado y vuelve a pedir (Constitución, Principio VIII): nunca muestra avisos de otra.
export function useAvisosReparacion(
  reparacionId: string | undefined,
  clienteId: string | undefined,
  empresaActivaId: string | null | undefined,
  habilitado: boolean,
): EstadoAvisosReparacion {
  const [avisos, setAvisos] = useState<AvisoReparacion[]>([])
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [clienteConCorreo, setClienteConCorreo] = useState<boolean | null>(null)
  const [avisando, setAvisando] = useState(false)
  const [errorAvisar, setErrorAvisar] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const ultima = useRef(0)
  const enVuelo = useRef(false)

  useEffect(() => {
    setAvisos([])
    setErrorAvisar(null)
    setAviso(null)
    setClienteConCorreo(null)
  }, [reparacionId, empresaActivaId])

  useEffect(() => {
    const peticion = ++ultima.current
    if (!reparacionId || !habilitado) {
      setCargando(false)
      setErrorCarga(null)
      return
    }
    setCargando(true)
    setErrorCarga(null)
    listarAvisosDeReparacion(reparacionId)
      .then((lista) => {
        if (peticion === ultima.current) setAvisos(lista)
      })
      .catch((error) => {
        if (peticion === ultima.current) setErrorCarga(mensajeDeCargarAvisos(error))
      })
      .finally(() => {
        if (peticion === ultima.current) setCargando(false)
      })
  }, [reparacionId, empresaActivaId, habilitado, version])

  useEffect(() => {
    if (!clienteId || !habilitado) return
    let vigente = true
    void clienteTieneCorreo(clienteId).then((tiene) => {
      if (vigente) setClienteConCorreo(tiene)
    })
    return () => {
      vigente = false
    }
  }, [clienteId, empresaActivaId, habilitado, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  const avisar = useCallback(
    async (estadoId?: string) => {
      // `enVuelo` cubre el doble clic antes de que el estado `avisando` llegue a pintarse.
      if (!reparacionId || enVuelo.current) return false
      enVuelo.current = true
      setAvisando(true)
      setErrorAvisar(null)
      setAviso(null)
      try {
        const resultado = await avisarClienteDeReparacion(reparacionId, estadoId)
        if (resultado.resultado === 'sin_correo') {
          setClienteConCorreo(false)
          setErrorAvisar(MENSAJE_CLIENTE_SIN_CORREO)
          return false
        }
        setAviso(MENSAJE_AVISO_ENCOLADO)
        setVersion((v) => v + 1)
        return true
      } catch (error) {
        setErrorAvisar(mensajeDeAvisar(error))
        return false
      } finally {
        enVuelo.current = false
        setAvisando(false)
      }
    },
    [reparacionId],
  )

  return { avisos, cargando, errorCarga, clienteConCorreo, avisando, errorAvisar, aviso, recargar, avisar }
}
