import { useCallback, useEffect, useRef, useState } from 'react'
import { useOrganizacionActiva } from '../hooks/useOrganizacionActiva'
import { hoyEnArgentina } from './reparaciones'
import { supabaseClient } from './supabase'

// Listado de reparaciones (F-SVC-04). La búsqueda, los filtros y la paginación viajan al servidor
// (`listar_reparaciones`): el navegador nunca descarga la lista completa (FR-007).

export type PeriodoReparaciones = 'hoy' | 'semana' | 'mes'

export const PERIODOS_REPARACIONES: ReadonlyArray<{ valor: PeriodoReparaciones; etiqueta: string }> = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
]

export const PERIODO_INICIAL: PeriodoReparaciones = 'mes'
export const TAMANO_PAGINA_REPARACIONES = 25

// Fila del listado: lo que devuelve `public.listar_reparaciones`. Sin costos internos.
export type ReparacionListada = {
  id: string
  numero: number
  codigo: string
  ingreso_en: string
  empresa_id: string
  empresa: string
  cliente: string
  equipo: string
  modelo: string
  numero_serie: string | null
  estado: string
  estado_tono: string
  tecnico_id: string | null
  tecnico: string | null
  entrega_prevista: string | null
  total_cliente: number
  // Repuestos pendientes de stock (F-SVC-12, FR-032); 0 si la reparación está anulada o entregada.
  pendientes_stock: number
}

export type FiltrosReparaciones = {
  // Empresa activa de la barra superior; null = «todas mis empresas».
  empresaId: string | null
  periodo: PeriodoReparaciones
  serie: string
  tecnicoId: string
  pagina: number
  tamano: number
}

type RespuestaListado = { total_filas: number | string; filas: ReparacionListada[] }

// «2026-10-22» → «22/10/2026» y «22/10», sin pasar por Date (evita el corrimiento por zona horaria).
export function formatearDiaCompleto(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${anio}`
}

export function formatearDiaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}`
}

export const subtituloPeriodo = (hoy: string = hoyEnArgentina()) =>
  `Según la fecha de entrega prevista (hoy: ${formatearDiaCompleto(hoy)})`

export function aReparacionListada(fila: ReparacionListada): ReparacionListada {
  return { ...fila, total_cliente: Number(fila.total_cliente ?? 0), pendientes_stock: Number(fila.pendientes_stock ?? 0) }
}

export async function listarReparaciones(filtros: FiltrosReparaciones): Promise<{ total: number; filas: ReparacionListada[] }> {
  const serie = filtros.serie.trim()
  const { data, error } = await supabaseClient.rpc('listar_reparaciones', {
    p_empresa: filtros.empresaId,
    p_periodo: filtros.periodo,
    p_serie: serie === '' ? null : serie,
    p_tecnico: filtros.tecnicoId === '' ? null : filtros.tecnicoId,
    p_pagina: filtros.pagina,
    p_tamano: filtros.tamano,
  })
  if (error) throw error
  const respuesta = (data ?? { total_filas: 0, filas: [] }) as RespuestaListado
  return { total: Number(respuesta.total_filas), filas: (respuesta.filas ?? []).map(aReparacionListada) }
}

type ErrorDeBase = { code?: string } | null

export function mensajeDeErrorListado(error: unknown): string {
  const codigo = (error as ErrorDeBase)?.code
  if (codigo === '42501') return 'Tu rol no puede ver las reparaciones. Si tu rol cambió, recargá la página.'
  return 'No pudimos cargar las reparaciones. Probá de nuevo.'
}

// «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras llega la siguiente página se
// conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera carga o el cambio de
// organización, y al cambiar de empresa activa se vacían las filas (nunca se muestran las de la anterior).
export function useListarReparaciones(filtros: FiltrosReparaciones) {
  const { empresaId, periodo, tecnicoId, pagina, tamano } = filtros
  // La serie recortada es la que viaja al RPC: «abc » y «abc» no deben disparar dos peticiones.
  const serie = filtros.serie.trim()
  const [filas, setFilas] = useState<ReparacionListada[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<{ organizacion: string | null; empresa: string | null } | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarReparaciones({ empresaId, periodo, serie, tecnicoId, pagina, tamano })
      if (peticion !== ultimaPeticion.current) return
      setFilas(resultado.filas)
      setTotal(resultado.total)
      setError(null)
    } catch (excepcion) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar las reparaciones.', excepcion)
      setFilas([])
      setTotal(0)
      setError(excepcion)
    }
    setCargando(false)
    setRespondidaPara({ organizacion: organizacionId, empresa: empresaId })
    // organizacionId solo dispara la recarga; la organización la resuelve la base.
  }, [empresaId, periodo, serie, tecnicoId, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined
    && respondidaPara.organizacion === organizacionId
    && respondidaPara.empresa === empresaId
  return {
    filas: respondio ? filas : [],
    total: respondio ? total : 0,
    isLoading: !respondio,
    isFetching: cargando,
    isError: error !== null,
    mensajeError: error === null ? null : mensajeDeErrorListado(error),
    refetch: cargar,
  }
}
