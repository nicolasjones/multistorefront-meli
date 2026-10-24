import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ConteoMargen,
  type UmbralMargen,
  guardarUmbralMargenBajo,
  leerConteoMargen,
  leerUmbralMargenBajo,
  mensajeDeErrorRentabilidad,
} from '../lib/rentabilidad'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Conteo de productos con margen bajo o negativo para el aviso del resumen (F-REN-02, FR-015).
// Es de la ORGANIZACIÓN (no de la empresa activa): se recarga si cambia la organización de trabajo
// (superadmin) o cuando el padre pide `recargar` (p. ej. tras guardar el umbral). «Última petición
// gana»; un error no se traga: queda en `hayError` y el aviso simplemente no se ofrece.
export function useConteoMargen(habilitado: boolean) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [conteo, setConteo] = useState<ConteoMargen | null>(null)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const resultado = await leerConteoMargen(supabaseClient)
      if (peticion === ultimaPeticion.current) setConteo(resultado)
    } catch (error) {
      console.error('No pudimos contar los productos con margen bajo.', error)
      if (peticion === ultimaPeticion.current) {
        setConteo(null)
        setHayError(true)
      }
    }
  }, [])

  useEffect(() => {
    // Nunca muestra el conteo de la organización anterior mientras llega el nuevo.
    setConteo(null)
    if (habilitado) void cargar()
  }, [cargar, habilitado, organizacionId])

  return { conteo, hayError, recargar: cargar }
}

export type ResultadoGuardarUmbral = { ok: true } | { ok: false; mensaje: string }

// Umbral vigente (con su `updated_at` para el bloqueo optimista) y su guardado (FR-018). Solo se
// monta al abrir el diálogo: cada apertura vuelve a leer el valor de la base.
export function useUmbralMargen() {
  const [umbral, setUmbral] = useState<UmbralMargen | null>(null)
  const [hayError, setHayError] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const enCurso = useRef(false)

  const cargar = useCallback(async () => {
    setHayError(false)
    try {
      setUmbral(await leerUmbralMargenBajo(supabaseClient))
    } catch (error) {
      console.error('No pudimos leer el umbral de margen bajo.', error)
      setUmbral(null)
      setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = useCallback(async (valor: number): Promise<ResultadoGuardarUmbral> => {
    // Guarda síncrona contra el doble clic: el estado tarda un render en deshabilitar el botón.
    if (enCurso.current) return { ok: false, mensaje: 'Ya estamos guardando el umbral.' }
    enCurso.current = true
    setGuardando(true)
    try {
      await guardarUmbralMargenBajo(supabaseClient, valor, umbral?.actualizadoEn ?? null)
      return { ok: true }
    } catch (error) {
      return { ok: false, mensaje: mensajeDeErrorRentabilidad(error as { code?: string }) }
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }, [umbral])

  return { umbral, hayError, guardando, recargar: cargar, guardar }
}
