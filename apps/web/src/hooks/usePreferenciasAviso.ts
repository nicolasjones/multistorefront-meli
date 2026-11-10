import { useCallback, useEffect, useRef, useState } from 'react'
import {
  guardarPreferenciaAviso, listarPreferenciasAviso, mensajeDeErrorAviso, type PreferenciaAviso,
} from '../lib/avisos'
import { supabaseClient } from '../lib/supabase'

export type ResultadoCambioAviso = { ok: true } | { ok: false; mensaje: string }

// Preferencias de aviso por correo del usuario (F-NOT-01, FR-003, FR-005). Son del USUARIO, no de la
// empresa activa: no se recargan al cambiar de empresa (SC-005). «Última petición gana»; un error de
// carga no se traga (`hayError`). El interruptor refleja lo que la base confirmó: si guardar falla, queda
// como estaba (nunca en un estado falso).
export function usePreferenciasAviso() {
  const [preferencias, setPreferencias] = useState<PreferenciaAviso[] | null>(null)
  const [hayError, setHayError] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)
  const enCurso = useRef(false)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const lista = await listarPreferenciasAviso(supabaseClient)
      if (peticion === ultimaPeticion.current) setPreferencias(lista)
    } catch (error) {
      console.error('No pudimos cargar los avisos por correo.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiar = useCallback(async (tipo: string, activo: boolean): Promise<ResultadoCambioAviso | null> => {
    // Un cambio por vez: ignora un segundo toque mientras el primero se guarda.
    if (enCurso.current) return null
    enCurso.current = true
    setGuardando(tipo)
    try {
      const { error } = await guardarPreferenciaAviso(supabaseClient, tipo, activo)
      if (error) {
        console.error('No pudimos guardar la preferencia de aviso.', error)
        return { ok: false, mensaje: mensajeDeErrorAviso(error) }
      }
      setPreferencias((actuales) => actuales?.map((fila) => (fila.tipo === tipo ? { ...fila, activo } : fila)) ?? actuales)
      return { ok: true }
    } catch (error) {
      console.error('No pudimos guardar la preferencia de aviso.', error)
      return { ok: false, mensaje: mensajeDeErrorAviso(null) }
    } finally {
      enCurso.current = false
      setGuardando(null)
    }
  }, [])

  return { preferencias, cargando: preferencias === null && !hayError, hayError, guardando, recargar: cargar, cambiar }
}
