import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type BaseRegla,
  type FilaPrevia,
  type ReglaPrecio,
  guardarReglaPrecioEmpresa,
  leerReglaPrecioEmpresa,
  parsearAjuste,
  previsualizarPreciosEmpresa,
  validarAjuste,
} from '../lib/precios'
import { supabaseClient } from '../lib/supabase'

// Regla de precio de UNA empresa (F-PRE-07, FR-014). El resultado queda atado al `empresaId`
// con que se pidió: al abrir otra empresa se descarta el de la anterior (nunca se muestra
// la regla ni los precios de otra), y «última petición gana» frena respuestas tardías.
export function usePreciosEmpresa(empresaId: string | undefined) {
  const [leida, setLeida] = useState<{ empresaId: string; regla: ReglaPrecio } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)
  const empresaVigente = useRef(empresaId)
  useEffect(() => {
    empresaVigente.current = empresaId
  }, [empresaId])
  const esVigente = useCallback((id: string) => empresaVigente.current === id, [])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    if (!empresaId) {
      setCargando(false)
      return
    }
    setCargando(true)
    setHayError(false)
    try {
      const regla = await leerReglaPrecioEmpresa(supabaseClient, empresaId)
      if (peticion === ultimaPeticion.current) setLeida({ empresaId, regla })
    } catch (error) {
      console.error('No pudimos cargar la regla de precio de la empresa.', error)
      if (peticion === ultimaPeticion.current) {
        setLeida(null)
        setHayError(true)
      }
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [empresaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const regla = leida && leida.empresaId === empresaId ? leida.regla : null

  // Lanza el error de la base: quien llama decide el mensaje. Si mientras tanto se abrió otra
  // empresa, el resultado se descarta y no pisa la regla de la actual.
  const guardar = useCallback(
    async (base: BaseRegla, ajustePct: number, mostrarConIva: boolean) => {
      if (!empresaId || !regla) throw new Error('La regla todavía no está cargada')
      const guardada = await guardarReglaPrecioEmpresa(supabaseClient, empresaId, { base, ajustePct, mostrarConIva }, regla.actualizadoEn)
      if (esVigente(empresaId)) setLeida({ empresaId, regla: guardada })
      return guardada
    },
    [empresaId, regla, esVigente],
  )

  return { regla, cargando, hayError, recargar: cargar, guardar, esVigente }
}

const ESPERA_PREVIA_MS = 300

// Muestra «Así quedan los precios» con la regla SIN guardar (FR-013): pide el cálculo al servidor
// (misma fórmula que la vista) con una pequeña espera mientras se escribe. Con un ajuste inválido
// no consulta y deja la tabla sin filas hasta que se corrija.
export function usePrevisualizacionPrecios(empresaId: string | undefined, base: BaseRegla, ajusteTexto: string, habilitada: boolean) {
  const [resultado, setResultado] = useState<{ clave: string; filas: FilaPrevia[] } | null>(null)
  const [errorDe, setErrorDe] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)
  const ultimaPeticion = useRef(0)

  const ajuste = base === 'central' ? 0 : parsearAjuste(ajusteTexto)
  const valida = habilitada && Boolean(empresaId) && validarAjuste(base, ajusteTexto) === undefined && ajuste !== null
  const clave = `${empresaId ?? ''}|${base}|${ajuste ?? ''}`

  useEffect(() => {
    if (!valida || !empresaId || ajuste === null) return
    const peticion = ++ultimaPeticion.current
    const temporizador = setTimeout(() => {
      previsualizarPreciosEmpresa(supabaseClient, empresaId, base, ajuste)
        .then((filas) => {
          if (peticion !== ultimaPeticion.current) return
          setResultado({ clave, filas })
          setErrorDe(null)
        })
        .catch((error) => {
          console.error('No pudimos calcular la vista previa de precios.', error)
          if (peticion === ultimaPeticion.current) setErrorDe(clave)
        })
    }, ESPERA_PREVIA_MS)
    return () => clearTimeout(temporizador)
  }, [valida, empresaId, base, ajuste, clave, reintento])

  const filas = valida && resultado && resultado.clave.startsWith(`${empresaId}|`) ? resultado.filas : null
  const hayError = valida && errorDe === clave
  const cargando = valida && !hayError && (resultado === null || resultado.clave !== clave)
  return { filas, cargando, hayError, reintentar: () => setReintento((n) => n + 1) }
}
