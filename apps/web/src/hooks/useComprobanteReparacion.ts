import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MENSAJE_COMPROBANTE_YA_EXISTE,
  generarComprobanteDeReparacion,
  mensajeDeCargarComprobante,
  mensajeDeGenerarComprobante,
  obtenerComprobanteDeReparacion,
  type ComprobanteDeReparacion,
} from '../lib/reparacionComprobante'

export type EstadoComprobanteReparacion = {
  comprobante: ComprobanteDeReparacion | null
  cargando: boolean
  // Ya se consultó la base para esta reparación y empresa (evita ofrecer acciones antes de saber si hay comprobante).
  consultado: boolean
  errorCarga: string | null
  generando: boolean
  errorGenerar: string | null
  // Aviso de éxito de la última generación (null si no hay).
  aviso: string | null
  recargar: () => void
  generar: () => Promise<void>
}

// Comprobante vigente de una reparación y la acción de generarlo (F-SVC-13). Al cambiar la reparación o la empresa
// activa descarta lo cargado y vuelve a pedir (Constitución, Principio VIII): nunca muestra el comprobante de otra.
export function useComprobanteReparacion(reparacionId: string | undefined, empresaActivaId: string | null | undefined, habilitado: boolean): EstadoComprobanteReparacion {
  const [comprobante, setComprobante] = useState<ComprobanteDeReparacion | null>(null)
  const [cargando, setCargando] = useState(false)
  const [consultado, setConsultado] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)
  const [errorGenerar, setErrorGenerar] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const ultima = useRef(0)

  // Otra reparación u otra empresa activa: se descarta todo lo del anterior.
  useEffect(() => {
    setComprobante(null)
    setConsultado(false)
    setErrorGenerar(null)
    setAviso(null)
  }, [reparacionId, empresaActivaId])

  useEffect(() => {
    const peticion = ++ultima.current
    if (!reparacionId || !habilitado) {
      setCargando(false)
      setConsultado(false)
      setErrorCarga(null)
      return
    }
    setCargando(true)
    setConsultado(false)
    setErrorCarga(null)
    obtenerComprobanteDeReparacion(reparacionId)
      .then((resultado) => {
        if (peticion === ultima.current) setComprobante(resultado)
      })
      .catch((error) => {
        if (peticion === ultima.current) setErrorCarga(mensajeDeCargarComprobante(error))
      })
      .finally(() => {
        if (peticion === ultima.current) {
          setCargando(false)
          setConsultado(true)
        }
      })
  }, [reparacionId, empresaActivaId, habilitado, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  const generar = useCallback(async () => {
    if (!reparacionId || generando) return
    setGenerando(true)
    setErrorGenerar(null)
    setAviso(null)
    try {
      const resultado = await generarComprobanteDeReparacion(reparacionId)
      setAviso(resultado.creado ? 'Comprobante generado' : MENSAJE_COMPROBANTE_YA_EXISTE)
      setVersion((v) => v + 1)
    } catch (error) {
      setErrorGenerar(mensajeDeGenerarComprobante(error))
    } finally {
      setGenerando(false)
    }
  }, [reparacionId, generando])

  return { comprobante, cargando, consultado, errorCarga, generando, errorGenerar, aviso, recargar, generar }
}
