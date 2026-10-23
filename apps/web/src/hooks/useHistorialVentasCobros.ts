import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type TipoConsultaHistorial = 'ventas' | 'cobros'

// Fila de `public.listar_historial_ventas` (F-VTA-38, FR-014/FR-016), sin los totales.
export type VentaHistorica = {
  id: string
  empresa_id: string
  empresa_nombre: string | null
  tipo: string
  numero: string
  fecha: string
  cliente_nombre: string
  cliente_numero: string | null
  operador: string | null
  estado_final: string | null
  total: number
}

// Fila de `public.listar_historial_cobros`, sin los totales.
export type CobroHistorico = {
  id: string
  empresa_id: string
  empresa_nombre: string | null
  fecha: string
  comprobante_numero: string
  cliente_nombre: string
  cliente_numero: string | null
  cuenta_cobro: string | null
  aprobado_por: string | null
  importe: number
}

type Totales = { total_filas: number | string; fecha_desde: string | null; fecha_hasta: string | null }

export const TAMANO_PAGINA_HISTORIAL = 25
const ESPERA_BUSQUEDA_MS = 300

const RPC_POR_TIPO: Readonly<Record<TipoConsultaHistorial, string>> = {
  ventas: 'listar_historial_ventas',
  cobros: 'listar_historial_cobros',
}

// Consulta del historial importado (solo lectura). La tienda (`empresaId`, '' = todas) la
// elige la pantalla y se conserva al cambiar de pestaña; búsqueda y paginación viajan, con ella, al
// servidor: el navegador nunca descarga el archivo completo. La búsqueda espera a que se
// deje de tipear y reinicia la página; «última petición gana» para que una respuesta vieja
// no pise a la nueva. Quien cambia la tienda debe volver a la página 1 (`setPagina(1)`). Mientras llega otra página se conservan las filas (`isFetching`);
// `isLoading` es solo la primera carga de cada pestaña u organización, para no parpadear.
// La autorización real es la RLS de `historial_*` y `empresas_accesibles()`, no este hook.
export function useHistorialVentasCobros<T extends VentaHistorica | CobroHistorico>(tipo: TipoConsultaHistorial, empresaId: string) {
  const [texto, setTextoCrudo] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [filas, setFilas] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [desde, setDesde] = useState<string | null>(null)
  const [hasta, setHasta] = useState<string | null>(null)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  // Pestaña y organización de la última respuesta recibida.
  const [respondidaPara, setRespondidaPara] = useState<string | null>(null)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const claveActual = `${tipo}:${organizacionId ?? ''}`
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
    let resultado: { data: Array<T & Totales> | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc(RPC_POR_TIPO[tipo], {
        p_busqueda: textoAplicado.trim() === '' ? null : textoAplicado.trim(),
        p_empresa_id: empresaId === '' ? null : empresaId,
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
      console.error(`No pudimos listar el historial de ${tipo}.`, error)
      setFilas([])
      setTotal(0)
      setDesde(null)
      setHasta(null)
    } else {
      const recibidas = data ?? []
      setFilas(recibidas.map(({ total_filas: _t, fecha_desde: _d, fecha_hasta: _h, ...fila }) => fila as unknown as T))
      setTotal(recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0)
      setDesde(recibidas[0]?.fecha_desde ?? null)
      setHasta(recibidas[0]?.fecha_hasta ?? null)
    }
    setCargando(false)
    setRespondidaPara(`${tipo}:${organizacionId ?? ''}`)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [tipo, textoAplicado, empresaId, pagina, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Página fuera de rango (p. ej. se filtró y quedó una sola): vuelve a la primera.
  useEffect(() => {
    if (!cargando && !hayError && filas.length === 0 && pagina > 1) setPagina(1)
  }, [cargando, hayError, filas.length, pagina])

  const setTexto = useCallback((valor: string) => setTextoCrudo(valor), [])

  return {
    filas,
    total,
    desde,
    hasta,
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
