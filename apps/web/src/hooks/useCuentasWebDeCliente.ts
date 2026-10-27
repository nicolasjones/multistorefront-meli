import { useCallback, useEffect, useRef, useState } from 'react'
import { listarCuentasWebDeCliente, type CuentaWeb } from '../lib/cuentasCliente'
import { useEmpresasAccesibles } from './useEmpresasAccesibles'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Cuentas web de un cliente por tienda (F-CLI-05, FR-013). La lectura la hace
// `cuentas_web_de_cliente` con la RLS del panel. Se relee al cambiar la empresa
// activa de la barra superior (Principio VIII, FR-017): la ficha no puede quedar
// con el estado de la tienda anterior.
export function useCuentasWebDeCliente(clienteId: string | undefined) {
  const [cuentas, setCuentas] = useState<CuentaWeb[]>([])
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(Boolean(clienteId))
  const [respondidaPara, setRespondidaPara] = useState<string | null | undefined>(undefined)
  const { organizacionActiva } = useOrganizacionActiva()
  const { empresaActivaId } = useEmpresasAccesibles()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    setHayError(false)
    if (!clienteId) {
      ++ultimaPeticion.current
      setCuentas([])
      setCargando(false)
      setRespondidaPara(null)
      return
    }
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const lista = await listarCuentasWebDeCliente(clienteId)
      if (peticion !== ultimaPeticion.current) return
      setCuentas(lista)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudieron cargar las cuentas web del cliente', error instanceof Error ? error.message : error)
      setCuentas([])
      setHayError(true)
    }
    setCargando(false)
    setRespondidaPara(clienteId)
    // organizacionId y empresaActivaId solo disparan la recarga; la RLS resuelve el alcance.
  }, [clienteId, organizacionId, empresaActivaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const respondio = respondidaPara === (clienteId ?? null)
  return { cuentas, isLoading: Boolean(clienteId) && (cargando || !respondio), isError: hayError, refetch: cargar }
}
