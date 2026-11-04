import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { TipoCliente } from '../lib/clientes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type DestinatarioCorreoMasivo = { id: string; numero: number; nombre: string; correo: string }

// Cuántos quedan y cuántos quedan afuera, y por qué (F-CLI-11, FR-004).
export type ResumenDestinatarios = { elegibles: number; sin_correo: number; no_aceptan: number }

export type FiltrosDestinatarios = {
  texto: string
  tipo: TipoCliente | null
  /** Empresa (tienda) activa de la pantalla; null = todas. Principio VIII. */
  empresaId: string | null
  conCuentaWeb: boolean
  /** Clientes marcados en el listado; null = lo arma solo el filtro. */
  clientes: string[] | null
  pagina: number
  tamano: number
}

type RespuestaLista = { total: number; filas: DestinatarioCorreoMasivo[] }

// Lista y resumen del grupo del correo masivo (`listar_` y `resumen_destinatarios_correo_masivo`).
// Los filtros viajan al servidor, que aplica la RLS del llamador y exige edición en Clientes.
// «Última petición gana». Mientras llega otra página o filtro se conservan las filas anteriores, salvo si
// cambia la organización o la empresa: ahí `isLoading` vuelve a ser verdadero y no se ve nada de la anterior.
export function useDestinatariosCorreoMasivo({ texto, tipo, empresaId, conCuentaWeb, clientes, pagina, tamano }: FiltrosDestinatarios) {
  const [filas, setFilas] = useState<DestinatarioCorreoMasivo[]>([])
  const [total, setTotal] = useState(0)
  const [resumen, setResumen] = useState<ResumenDestinatarios | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  // Contexto (organización + empresa) de la última respuesta; undefined = ninguna.
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const contexto = `${organizacionActiva?.id ?? ''}|${empresaId ?? ''}`
  const ultimaPeticion = useRef(0)
  // Una nueva lista de marcados con el mismo contenido no debe recargar: se compara por valor.
  const marcados = clientes === null ? null : clientes.join(',')

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    const filtros = {
      p_texto: texto.trim() === '' ? null : texto.trim(),
      p_tipo: tipo,
      p_empresa: empresaId,
      p_con_cuenta_web: conCuentaWeb,
      p_clientes: marcados === null ? null : marcados === '' ? [] : marcados.split(','),
    }
    let lista: { data: RespuestaLista | null; error: unknown }
    let resumida: { data: ResumenDestinatarios | null; error: unknown }
    try {
      ;[lista, resumida] = await Promise.all([
        supabaseClient.rpc('listar_destinatarios_correo_masivo', { ...filtros, p_pagina: pagina, p_tamano: tamano }),
        supabaseClient.rpc('resumen_destinatarios_correo_masivo', filtros),
      ])
    } catch (excepcion) {
      lista = { data: null, error: excepcion }
      resumida = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const error = lista.error || resumida.error || !lista.data || !resumida.data
    setHayError(Boolean(error))
    if (error) {
      setFilas([])
      setTotal(0)
      setResumen(null)
    } else {
      setFilas(lista.data?.filas ?? [])
      setTotal(Number(lista.data?.total ?? 0))
      setResumen(resumida.data)
    }
    setCargando(false)
    setRespondidaPara(contexto)
  }, [texto, tipo, empresaId, conCuentaWeb, marcados, pagina, tamano, contexto])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return {
    filas,
    total,
    resumen,
    isLoading: respondidaPara !== contexto,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
