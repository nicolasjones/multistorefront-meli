import { useCallback, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { textoErrorCorreoMasivo } from '../lib/correoMasivo'

export type GrupoCampana = {
  /** Empresa (tienda) activa; null = todas. */
  empresaId: string | null
  texto: string
  tipo: string | null
  conCuentaWeb: boolean
  /** Clientes marcados en el listado; null = lo arma solo el filtro. */
  clientes: string[] | null
}

export type PedidoCampana = GrupoCampana & { clave: string; asunto: string; mensaje: string }

export type ResultadoEnvio = { ok: true } | { ok: false; error: string }

// Crear la campaña (`crear_campana_correo`) y pedir la prueba al autor (`solicitar_prueba_correo_masivo`). Ambas
// exigen edición en Clientes y la base lo vuelve a verificar; acá solo se traduce el error para la persona.
export function useCorreoMasivo() {
  const [enviando, setEnviando] = useState(false)

  const crearCampana = useCallback(async (pedido: PedidoCampana): Promise<ResultadoEnvio> => {
    setEnviando(true)
    try {
      const { error } = await supabaseClient.rpc('crear_campana_correo', {
        p_clave: pedido.clave,
        p_asunto: pedido.asunto.trim(),
        p_mensaje: pedido.mensaje,
        p_empresa: pedido.empresaId,
        p_texto: pedido.texto.trim() === '' ? null : pedido.texto.trim(),
        p_tipo: pedido.tipo,
        p_con_cuenta_web: pedido.conCuentaWeb,
        p_clientes: pedido.clientes,
      })
      return error ? { ok: false, error: textoErrorCorreoMasivo(error) } : { ok: true }
    } catch {
      return { ok: false, error: textoErrorCorreoMasivo(null) }
    } finally {
      setEnviando(false)
    }
  }, [])

  const enviarPrueba = useCallback(async (asunto: string, mensaje: string): Promise<ResultadoEnvio> => {
    try {
      const { error } = await supabaseClient.rpc('solicitar_prueba_correo_masivo', { p_asunto: asunto.trim(), p_mensaje: mensaje })
      return error ? { ok: false, error: textoErrorCorreoMasivo(error) } : { ok: true }
    } catch {
      return { ok: false, error: textoErrorCorreoMasivo(null) }
    }
  }, [])

  return { crearCampana, enviarPrueba, enviando }
}
