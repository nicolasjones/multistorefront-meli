import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { Cliente, EmpresaDeCliente, TipoCliente } from '../lib/clientes'
import type { CuentaWeb } from '../lib/cuentasCliente'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Fila del listado: lo que devuelve `public.buscar_clientes` (F-CLI-02). Además
// de las columnas de la ficha, `empresas` trae las tiendas del cliente (F-CLI-05).
export type ClienteListado = Pick<
  Cliente,
  'id' | 'numero' | 'nombre' | 'documento' | 'correo' | 'telefono' | 'celular' | 'localidad' | 'expreso_preferido' | 'tipo' | 'es_consumidor_final' | 'archivado_en'
> & { empresas: EmpresaDeCliente[]; cuentas_web: CuentaWeb[] }

export type FiltrosClientes = {
  texto: string
  tipo: TipoCliente | null
  archivados: boolean
  /** Tienda (empresa) por la que se filtra el listado (F-CLI-11); null = todas. */
  empresaId: string | null
  /** «Con cuenta web»: deja los clientes con cuenta activa y habilitados (FR-014). */
  conCuentaWeb: boolean
  pagina: number
  tamano: number
}

type FilaBusqueda = ClienteListado & { total: number | string }

// Búsqueda, filtros y paginación viajan al servidor (`buscar_clientes`, RLS del
// llamador): el navegador nunca descarga la lista completa. «Última petición
// gana»: una respuesta vieja no pisa a la nueva. Mientras llega la siguiente
// página se conservan las filas anteriores (`isFetching`), y `isLoading` es
// solo la primera carga (o el cambio de organización), para no parpadear.
export function useBuscarClientes({ texto, tipo, archivados, empresaId, conCuentaWeb, pagina, tamano }: FiltrosClientes) {
  const [clientes, setClientes] = useState<ClienteListado[]>([])
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
    let resultado: { data: FilaBusqueda[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('buscar_clientes', {
        p_texto: texto.trim() === '' ? null : texto.trim(),
        p_tipo: tipo,
        p_archivados: archivados,
        p_pagina: pagina,
        p_tamano: tamano,
        p_empresa_id: empresaId,
        p_con_cuenta_web: conCuentaWeb,
      })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      setClientes([])
      setTotal(0)
    } else {
      const filas = data ?? []
      setClientes(filas.map(({ total: _total, ...cliente }) => cliente))
      setTotal(filas.length > 0 ? Number(filas[0].total) : 0)
    }
    setCargando(false)
    setRespondidaPara(organizacionId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [texto, tipo, archivados, empresaId, conCuentaWeb, pagina, tamano, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara !== undefined && respondidaPara === organizacionId
  return {
    clientes,
    total,
    isLoading: !respondio,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
