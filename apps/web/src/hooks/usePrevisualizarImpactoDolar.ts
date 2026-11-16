import { useCallback, useEffect, useRef, useState } from 'react'
import { type Previsualizacion, previsualizarImpactoDolarRpc } from '../lib/cotizacion'
import { supabaseClient } from '../lib/supabase'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

const ESPERA_MS = 400

type Resultado = { valor: number; empresaId: string | null; organizacionId: string | null; previa: Previsualizacion | null; error: boolean }

// Vista previa del impacto de un valor de dólar mientras se tipea (F-INI-07, FR-019). Llama a la RPC de
// SOLO LECTURA `previsualizar_impacto_dolar` con una espera corta (no pide en cada tecla) y «la última
// petición gana». Sin valor válido (`valor` null) no llama y no muestra nada. No escribe la cotización
// pendiente: cerrar el diálogo sin confirmar no deja ningún rastro. El resultado se guarda con el valor, la
// empresa y la organización con que se pidió: si cambian, `previa` deja de verse (nunca se muestra el impacto de
// otro valor como si fuera el actual) sin necesidad de limpiar estado dentro de un efecto.
// `anterior`: el último impacto calculado con éxito (de otro valor): la pantalla puede dejarlo atenuado mientras
// llega el nuevo, para que no parpadee un esqueleto en cada pausa al tipear. Nunca habilita guardar.
// Costo: una llamada por pausa de 400 ms; quien lo usa evita pedir valores intermedios absurdos (ver el diálogo).
export function usePrevisualizarImpactoDolar(valor: number | null, empresaId: string | null = null) {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [anterior, setAnterior] = useState<Previsualizacion | null>(null)
  const ultimaPeticion = useRef(0)

  const pedir = useCallback(async (valorPedido: number) => {
    const peticion = ++ultimaPeticion.current
    const clave = { valor: valorPedido, empresaId, organizacionId: organizacionId ?? null }
    try {
      const previa = await previsualizarImpactoDolarRpc(supabaseClient, valorPedido, empresaId)
      if (peticion === ultimaPeticion.current) {
        setResultado({ ...clave, previa, error: false })
        setAnterior(previa)
      }
    } catch (error) {
      console.error('No pudimos calcular el impacto del dólar.', error)
      if (peticion === ultimaPeticion.current) setResultado({ ...clave, previa: null, error: true })
    }
  }, [empresaId, organizacionId])

  useEffect(() => {
    if (valor === null) {
      ultimaPeticion.current++
      return undefined
    }
    const espera = setTimeout(() => void pedir(valor), ESPERA_MS)
    return () => {
      clearTimeout(espera)
    }
  }, [valor, pedir])

  // Al desmontar, una respuesta en vuelo ya no actualiza nada.
  useEffect(() => () => { ultimaPeticion.current++ }, [])

  const vigente = valor !== null && resultado
    && resultado.valor === valor && resultado.empresaId === empresaId && resultado.organizacionId === (organizacionId ?? null)
    ? resultado
    : null
  const recargar = useCallback(() => {
    if (valor === null) return
    setResultado(null)
    void pedir(valor)
  }, [valor, pedir])

  return {
    previa: vigente?.previa ?? null,
    anterior: valor !== null ? anterior : null,
    cargando: valor !== null && vigente === null,
    hayError: vigente?.error ?? false,
    recargar,
  }
}
