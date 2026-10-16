import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { rangoDelPeriodo, TAMANO_PAGINA_ACTIVIDAD, type EventoActividadListado, type FiltrosActividad } from '../lib/actividad'
import { useOrganizacionActiva } from './useOrganizacionActiva'

type FilaListado = {
  id: string
  creado_en: string
  tipo: string
  empresa_id: string | null
  empresa_nombre: string | null
  actor_id: string | null
  actor_nombre: string | null
  detalle: string
  total: number | string
}

export type OpcionesActividad = {
  tipos: string[]
  actores: { id: string; nombre: string }[]
}

const SIN_OPCIONES: OpcionesActividad = { tipos: [], actores: [] }

// Listado paginado en servidor sobre `listar_actividad` (security invoker: la
// RLS de `registro_actividad` decide quién ve qué). Nunca trae todo el
// historial al navegador. «Última petición gana»: si cambian los filtros o la
// organización con una carga en vuelo, la respuesta vieja se descarta.
export function useActividad(filtros: FiltrosActividad, pagina: number) {
  const [eventos, setEventos] = useState<EventoActividadListado[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)
  const { periodo, empresa, actor, tipo, texto } = filtros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    const { desde, hasta } = rangoDelPeriodo(periodo)
    let resultado: { data: FilaListado[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('listar_actividad', {
        p_desde: desde,
        p_hasta: hasta,
        p_empresa: empresa,
        p_actor: actor,
        p_tipo: tipo,
        p_texto: texto.trim() === '' ? null : texto.trim(),
        p_pagina: pagina,
        p_tamano: TAMANO_PAGINA_ACTIVIDAD,
      })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    const filas = error ? [] : data ?? []
    setEventos(
      filas.map((fila) => ({
        id: fila.id,
        creadoEn: fila.creado_en,
        tipo: fila.tipo,
        empresaId: fila.empresa_id,
        empresaNombre: fila.empresa_nombre,
        actorId: fila.actor_id,
        actorNombre: fila.actor_nombre,
        detalle: fila.detalle,
      })),
    )
    setTotal(filas.length > 0 ? Number(filas[0].total) : 0)
    setCargando(false)
  }, [periodo, empresa, actor, tipo, texto, pagina])

  // organizacionId solo dispara la recarga; RLS resuelve la organización.
  useEffect(() => {
    void cargar()
  }, [cargar, organizacionId])

  return { eventos, total, isLoading: cargando, isError: hayError, refetch: cargar }
}

// Tipos y usuarios presentes en el historial, para los filtros.
export function useOpcionesActividad() {
  const [opciones, setOpciones] = useState<OpcionesActividad>(SIN_OPCIONES)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null

  useEffect(() => {
    let vigente = true
    void (async () => {
      try {
        const { data, error } = await supabaseClient.rpc('opciones_actividad')
        if (!vigente) return
        setOpciones(error || !data ? SIN_OPCIONES : (data as OpcionesActividad))
      } catch {
        if (vigente) setOpciones(SIN_OPCIONES)
      }
    })()
    return () => {
      vigente = false
    }
  }, [organizacionId])

  return opciones
}
