import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../../lib/supabase'
import { LIMITE_TANDA, type Notificacion, type TandaNotificaciones } from './notificaciones'

export const INTERVALO_REFRESCO_MS = 60_000

// FR-009: el conteo se refresca al montar el panel, al volver a la pestaña y cada 60 s solo con la
// pestaña visible (nunca consulta con la pestaña oculta).
export function useConteoSinLeer() {
  const [conteo, setConteoCrudo] = useState(0)
  // Cada refresco y cada cambio local (marcar leído) abre una generación nueva: una respuesta que llega después de que
  // la persona ya marcó, o después de otro refresco, se descarta en vez de hacer reaparecer el punto rojo.
  const generacion = useRef(0)

  const setConteo = useCallback((valor: number | ((actual: number) => number)) => {
    generacion.current++
    setConteoCrudo(valor)
  }, [])

  const refrescar = useCallback(async () => {
    if (document.visibilityState === 'hidden') return
    const actual = ++generacion.current
    const { data, error } = await supabaseClient.rpc('contar_notificaciones_sin_leer')
    if (actual !== generacion.current) return
    if (!error && typeof data === 'number') setConteoCrudo(data)
  }, [])

  useEffect(() => {
    void refrescar()
    const temporizador = window.setInterval(() => { void refrescar() }, INTERVALO_REFRESCO_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') void refrescar() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      window.clearInterval(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [refrescar])

  return { conteo, setConteo, refrescar }
}

// Lista por tandas: la siguiente se suma a lo ya mostrado (cursor = `creado_en` del último).
export function useListaNotificaciones(abierta: boolean) {
  const [items, setItems] = useState<Notificacion[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)
  const [errorMas, setErrorMas] = useState(false)
  const [cargada, setCargada] = useState(false)
  const generacion = useRef(0)
  const enVuelo = useRef(false)
  const itemsRef = useRef<Notificacion[]>([])
  itemsRef.current = items

  const cargar = useCallback(async (reiniciar: boolean) => {
    if (enVuelo.current && !reiniciar) return
    const actual = ++generacion.current
    enVuelo.current = true
    const previos = reiniciar ? [] : itemsRef.current
    setCargando(true)
    if (reiniciar) setError(false)
    else setErrorMas(false)
    const ultimo = previos.length ? previos[previos.length - 1] : null
    const { data, error: fallo } = await supabaseClient.rpc('listar_notificaciones', {
      p_limite: LIMITE_TANDA,
      p_antes_de: ultimo ? ultimo.creado_en : null,
      p_antes_id: ultimo ? ultimo.id : null,
    })
    if (actual !== generacion.current) return
    enVuelo.current = false
    setCargando(false)
    if (fallo || !data) {
      if (reiniciar) setError(true)
      else setErrorMas(true)
      return
    }
    const tanda = data as TandaNotificaciones
    setItems([...previos, ...tanda.items])
    setTotal(tanda.total)
    setCargada(true)
  }, [])

  useEffect(() => {
    if (abierta) void cargar(true)
  }, [abierta, cargar])

  const marcarLocal = useCallback((ids: string[] | null) => {
    const ahora = new Date().toISOString()
    setItems((actuales) => actuales.map((n) => (n.leido_en === null && (ids === null || ids.includes(n.id)) ? { ...n, leido_en: ahora } : n)))
  }, [])

  return {
    items,
    total,
    cargando,
    error,
    errorMas,
    cargada,
    hayMas: items.length < total,
    cargarMas: () => cargar(false),
    recargar: () => cargar(true),
    marcarLocal,
  }
}
