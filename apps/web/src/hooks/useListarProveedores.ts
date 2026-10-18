import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type EstadoProveedores = 'activos' | 'inactivos' | 'todos'

// Fila del listado: lo que devuelve `public.listar_proveedores` (F-PRV-02, FR-010).
export type ProveedorListado = {
  id: string
  razon_social: string
  cuit: string
  correo: string | null
  telefono: string | null
  activo: boolean
}

export type FiltrosProveedores = {
  texto: string
  estado: EstadoProveedores
  pagina: number
  tamano: number
}

type FilaListado = ProveedorListado & { total_filas: number | string }

// Búsqueda, estado y paginación viajan al servidor (`listar_proveedores`, RLS del
// llamador): el navegador nunca descarga la lista completa. «Última petición gana»:
// una respuesta vieja no pisa a la nueva. Mientras llega la siguiente página se
// conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera carga
// (o el cambio de organización), para no parpadear.
export function useListarProveedores({ texto, estado, pagina, tamano }: FiltrosProveedores) {
  const [proveedores, setProveedores] = useState<ProveedorListado[]>([])
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
      resultado = await supabaseClient.rpc('listar_proveedores', {
        p_busqueda: texto.trim() === '' ? null : texto.trim(),
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
      console.error('No pudimos listar los proveedores.', error)
      setProveedores([])
      setTotal(0)
    } else {
      const filas = data ?? []
      setProveedores(filas.map(({ total_filas: _total, ...proveedor }) => proveedor))
      setTotal(filas.length > 0 ? Number(filas[0].total_filas) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [texto, estado, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return {
    proveedores,
    total,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
