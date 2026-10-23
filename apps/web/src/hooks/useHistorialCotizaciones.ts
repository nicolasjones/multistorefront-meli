import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'
import { TAMANO_PAGINA_HISTORIAL } from './useHistorialVentasCobros'

// Fila de `public.listar_historial_cotizaciones` (F-VTA-39, FR-020), sin el total.
export type CotizacionHistorica = {
  id: string
  fecha: string
  dolar_comprador: number
  dolar_vendedor: number
  cargado_por: string | null
}

type FilaRpc = CotizacionHistorica & { total_filas: number | string }

const ESPERA_BUSQUEDA_MS = 300

// Consulta de las cotizaciones del dólar archivadas (solo lectura). Son globales de la
// organización: no hay tienda. Búsqueda por fecha y paginación viajan al servidor; la búsqueda
// espera a que se deje de tipear y reinicia la página; «última petición gana». La autorización
// real es la RLS de `historial_cotizaciones_dolar`, no este hook.
export function useHistorialCotizaciones() {
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [filas, setFilas] = useState<CotizacionHistorica[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | null>(null)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const claveActual = organizacionId ?? ''
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    if (texto === textoAplicado) return
    const espera = setTimeout(() => {
      setTextoAplicado(texto)
      setPagina(1)
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaRpc[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('listar_historial_cotizaciones', {
        p_busqueda: textoAplicado.trim() === '' ? null : textoAplicado.trim(),
        p_pagina: pagina,
        p_tamano: TAMANO_PAGINA_HISTORIAL,
      })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      console.error('No pudimos listar las cotizaciones históricas del dólar.', error)
      setFilas([])
      setTotal(0)
    } else {
      const recibidas = data ?? []
      setFilas(recibidas.map(({ total_filas: _total, ...fila }) => ({ ...fila, dolar_comprador: Number(fila.dolar_comprador), dolar_vendedor: Number(fila.dolar_vendedor) })))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId ?? '')
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [textoAplicado, pagina, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Página fuera de rango (p. ej. se filtró y quedó una sola): vuelve a la primera.
  useEffect(() => {
    if (!cargando && !hayError && filas.length === 0 && pagina > 1) setPagina(1)
  }, [cargando, hayError, filas.length, pagina])

  return {
    filas,
    total,
    texto,
    setTexto,
    textoAplicado,
    pagina,
    setPagina,
    isLoading: respondidaPara !== claveActual,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
