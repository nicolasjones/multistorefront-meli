import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { CampanaHistorial, DestinatarioCampana, DetalleCampana } from '../lib/correoMasivoHistorial'
import { useOrganizacionActiva } from './useOrganizacionActiva'

type RespuestaHistorial = { total: number; filas: CampanaHistorial[] }
type RespuestaDetalle = { campana: DetalleCampana; total: number; destinatarios: DestinatarioCampana[] }

// Lista de campañas (`listar_campanas_correo`), solo lectura. «Última petición gana». `isLoading` vuelve a ser
// verdadero al cambiar organización o empresa: nunca se muestran filas ni totales de la anterior (Principio VIII).
export function useHistorialCorreoMasivo({ empresaId, pagina, tamano }: { empresaId: string | null; pagina: number; tamano: number }) {
  const [filas, setFilas] = useState<CampanaHistorial[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const contexto = `${organizacionActiva?.id ?? ''}|${empresaId ?? ''}`
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let respuesta: { data: RespuestaHistorial | null; error: unknown }
    try {
      respuesta = await supabaseClient.rpc('listar_campanas_correo', { p_empresa: empresaId, p_pagina: pagina, p_tamano: tamano })
    } catch (excepcion) {
      respuesta = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    const error = respuesta.error || !respuesta.data
    setHayError(Boolean(error))
    setFilas(error ? [] : respuesta.data?.filas ?? [])
    setTotal(error ? 0 : Number(respuesta.data?.total ?? 0))
    setCargando(false)
    setRespondidaPara(contexto)
  }, [empresaId, pagina, tamano, contexto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { filas, total, isLoading: respondidaPara !== contexto, isFetching: cargando, isError: hayError, refetch: cargar }
}

// Detalle de una campaña (`detalle_campana_correo`). `noExiste` = la base respondió que no es de esta organización.
export function useDetalleCampanaCorreo({ campanaId, pagina, tamano }: { campanaId: string; pagina: number; tamano: number }) {
  const [datos, setDatos] = useState<RespuestaDetalle | null>(null)
  const [hayError, setHayError] = useState(false)
  const [noExiste, setNoExiste] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const contexto = `${organizacionActiva?.id ?? ''}|${campanaId}`
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let respuesta: { data: RespuestaDetalle | null; error: { code?: string } | null }
    try {
      respuesta = await supabaseClient.rpc('detalle_campana_correo', { p_campana: campanaId, p_pagina: pagina, p_tamano: tamano })
    } catch {
      respuesta = { data: null, error: {} }
    }
    if (peticion !== ultimaPeticion.current) return
    setNoExiste(respuesta.error?.code === 'P0002')
    setHayError(Boolean(respuesta.error && respuesta.error.code !== 'P0002') || (!respuesta.error && !respuesta.data))
    setDatos(respuesta.error ? null : respuesta.data)
    setCargando(false)
    setRespondidaPara(contexto)
  }, [campanaId, pagina, tamano, contexto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return { datos, noExiste, isLoading: respondidaPara !== contexto, isFetching: cargando, isError: hayError, refetch: cargar }
}
