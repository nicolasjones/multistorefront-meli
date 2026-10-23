import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { CuentaCobro, EstadoCuentasCobro } from '../lib/ventas/cuentasCobro'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type FiltrosCuentasCobro = {
  // Id de la tienda por la que filtrar; null = todas.
  empresaId: string | null
  estado: EstadoCuentasCobro
  pagina: number
  tamano: number
}

type FilaListado = CuentaCobro & { total_filas: number | string }

// Tienda, estado y paginación viajan al servidor (`listar_cuentas_cobro`, RLS del llamador): el navegador
// nunca descarga la lista completa. «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras
// llega la siguiente página se conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera
// carga (o el cambio de organización), para no parpadear.
export function useListarCuentasCobro({ empresaId, estado, pagina, tamano }: FiltrosCuentasCobro) {
  const [cuentas, setCuentas] = useState<CuentaCobro[]>([])
  const [total, setTotal] = useState(0)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  // Organización para la que llegó la última respuesta (undefined = ninguna).
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaListado[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('listar_cuentas_cobro', {
        p_empresa_id: empresaId,
        p_estado: estado,
        p_pagina: pagina,
        p_tamano: tamano,
      })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      console.error('No pudimos listar las cuentas de cobro.', error)
      setCuentas([])
      setTotal(0)
    } else {
      const filas = data ?? []
      setCuentas(filas.map(({ total_filas: _total, ...cuenta }) => cuenta))
      setTotal(filas.length > 0 ? Number(filas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [empresaId, estado, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return {
    cuentas,
    total,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
