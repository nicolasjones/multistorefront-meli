import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Cliente ↔ empresas (tiendas) (F-CLI-05). La relación vive en
// `public.clientes_empresas` y la escribe solo la RPC
// `public.guardar_empresas_de_cliente` (contrato en docs/clientes.md).
// Acá se lee (para la ficha y la edición) y se guarda el conjunto completo.
// Ver docs/clientes.md § «Relación con empresas».

type FilaEmpresa = { empresa_id: string }

// Tiendas (ids de empresa) en las que está habilitado un cliente. RLS por
// organización y sección filtra del lado del servidor.
export function useEmpresasDeCliente(clienteId: string | undefined) {
  const [empresas, setEmpresas] = useState<string[]>([])
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(Boolean(clienteId))
  // Cliente para el que llegó la última respuesta (undefined = ninguna; null =
  // no había cliente que cargar). Evita pintar una selección ajena.
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: si cambia el cliente o la organización activa, una
  // respuesta vieja no pisa a la nueva.
  const cargar = useCallback(async () => {
    setHayError(false)
    if (!clienteId) {
      ++ultimaPeticion.current
      setEmpresas([])
      setCargando(false)
      setRespondidaPara(null)
      return
    }
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaEmpresa[] | null; error: unknown }
    try {
      resultado = await supabaseClient
        .from('clientes_empresas')
        .select('empresa_id')
        .eq('cliente_id', clienteId)
        .returns<FilaEmpresa[]>()
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    setEmpresas(error ? [] : (data ?? []).map((fila) => fila.empresa_id))
    setCargando(false)
    setRespondidaPara(clienteId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [clienteId, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Sin respuesta para este cliente cuenta como cargando: evita el parpadeo del
  // vacío (o de la selección del cliente anterior) en el render previo al efecto.
  const respondio = respondidaPara === (clienteId ?? null)
  return { empresas, isLoading: Boolean(clienteId) && (cargando || !respondio), isError: hayError, refetch: cargar }
}

// Reemplaza el conjunto de tiendas de un cliente. Rechaza con el error del
// servidor (permiso, cliente o empresa fuera de la organización).
export function useGuardarEmpresasDeCliente() {
  const guardar = useCallback(async (clienteId: string, empresaIds: string[]) => {
    const { error } = await supabaseClient.rpc('guardar_empresas_de_cliente', {
      p_cliente_id: clienteId,
      p_empresa_ids: empresaIds,
    })
    if (error) throw error
  }, [])

  return { guardar }
}
