import { useCallback, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { type LineaIngreso, lineasParaRpc } from '../lib/ingresos'

export type ParametrosRegistrarIngreso = {
  empresaId: string
  proveedorId: string
  fecha: string
  comprobante: string
  lineas: LineaIngreso[]
  actualizarCosto: boolean
  claveIdempotencia: string
}

export type IngresoRegistrado = {
  id: string
  estado: 'registrado' | 'anulado'
  fecha: string
  creado_en: string
}

// F-PRV-04: llama a la RPC atómica. La validación de negocio y los permisos viven en
// la base; este hook solo traduce el formulario y expone el estado de envío.
export function useRegistrarIngreso() {
  const [enviando, setEnviando] = useState(false)

  const registrar = useCallback(async (parametros: ParametrosRegistrarIngreso) => {
    setEnviando(true)
    try {
      const { data, error } = await supabaseClient.rpc('registrar_ingreso_mercaderia', {
        p_empresa: parametros.empresaId,
        p_proveedor: parametros.proveedorId,
        p_fecha: parametros.fecha,
        p_comprobante: parametros.comprobante.trim() === '' ? null : parametros.comprobante.trim(),
        p_lineas: lineasParaRpc(parametros.lineas),
        p_actualizar_costo: parametros.actualizarCosto,
        p_clave_idempotencia: parametros.claveIdempotencia,
      })
      if (error) return { ok: false as const, error }
      return { ok: true as const, data: data as unknown as IngresoRegistrado }
    } catch (error) {
      return { ok: false as const, error }
    } finally {
      setEnviando(false)
    }
  }, [])

  return { registrar, enviando }
}
