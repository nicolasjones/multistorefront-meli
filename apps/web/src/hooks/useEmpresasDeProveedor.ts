import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Proveedor ↔ tiendas «Compra para» (MSF-524). La relación vive en
// `dominio.proveedores_empresas` y la escribe solo la RPC
// `public.guardar_empresas_de_proveedor` (docs/proveedores.md § «Compra para»).

type FilaEmpresa = { empresa_id: string }

// Ids de las tiendas para las que se le compra a un proveedor. RLS por organización
// y sección filtra del lado del servidor. «Última petición gana».
export function useEmpresasDeProveedor(proveedorId: string | undefined) {
  const [empresas, setEmpresas] = useState<string[]>([])
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(Boolean(proveedorId))
  // Proveedor para el que llegó la última respuesta (undefined = ninguna; null = no había que cargar).
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    setHayError(false)
    if (!proveedorId) {
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
        .schema('dominio')
        .from('proveedores_empresas')
        .select('empresa_id')
        .eq('proveedor_id', proveedorId)
        .returns<FilaEmpresa[]>()
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    if (error) console.error('No pudimos cargar las tiendas del proveedor.', error)
    setHayError(Boolean(error))
    setEmpresas(error ? [] : (data ?? []).map((fila) => fila.empresa_id))
    setCargando(false)
    setRespondidaPara(proveedorId)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [proveedorId, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara === (proveedorId ?? null)
  return { empresas, isLoading: Boolean(proveedorId) && (cargando || !respondio), isError: hayError, refetch: cargar }
}

// Reemplaza el conjunto de tiendas de un proveedor. Rechaza con el error del servidor.
export async function guardarEmpresasDeProveedor(proveedorId: string, empresaIds: string[]): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_empresas_de_proveedor', {
    p_proveedor_id: proveedorId,
    p_empresa_ids: empresaIds,
  })
  if (error) throw error
}
