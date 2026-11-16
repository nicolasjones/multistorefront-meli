import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

// Comprobante abierto de la cuenta corriente del cliente: lo que devuelve
// `public.cuenta_corriente_cliente` (F-CLI-19) y que la ficha muestra.
export type ComprobanteDeuda = {
  // El id del comprobante: el número se repite entre tiendas (el correlativo es por
  // empresa), así que el id es lo que identifica a la fila.
  id: string
  numero: string
  fecha: string
  estado: string
  total_con_iva: number
  cobrado: number
  // Lo que restan las notas de crédito emitidas sobre esta factura (devoluciones, descuentos).
  notas_credito: number
  saldo: number
}

// La fila que llega del servidor: el encabezado (`saldo_total`) viaja en cada fila
// y la de encabezado (sin documentos) trae los datos en nulo.
type FilaServidor = {
  id: string | null
  saldo_total: number | string
  numero: string | null
  fecha: string | null
  estado: string | null
  total_con_iva: number | string | null
  cobrado: number | string | null
  notas_credito: number | string | null
  saldo: number | string | null
}

// Cuenta corriente del cliente: cuánto debe y qué documentos tiene abiertos.
// La autorización y el aislamiento por organización los resuelve la función en
// el servidor; acá solo se muestran errores. «Última petición gana».
export function useCuentaCorrienteCliente(clienteId: string | undefined) {
  const [saldo, setSaldo] = useState(0)
  const [documentos, setDocumentos] = useState<ComprobanteDeuda[]>([])
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!clienteId) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: FilaServidor[] | null; error: unknown }
    try {
      resultado = await supabaseClient.rpc('cuenta_corriente_cliente', { p_cliente_id: clienteId })
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return

    const { data, error } = resultado
    setHayError(Boolean(error))
    if (error) {
      setDocumentos([])
      setSaldo(0)
    } else {
      const filas = data ?? []
      // El encabezado (saldo total) viaja en cada fila; la primera lo trae.
      setSaldo(filas.length > 0 ? Number(filas[0].saldo_total) : 0)
      setDocumentos(filas.filter((f) => f.numero !== null).map((f) => ({
        id: String(f.id),
        numero: String(f.numero),
        fecha: String(f.fecha),
        estado: String(f.estado),
        total_con_iva: Number(f.total_con_iva ?? 0),
        cobrado: Number(f.cobrado ?? 0),
        notas_credito: Number(f.notas_credito ?? 0),
        saldo: Number(f.saldo),
      })))
    }
    setCargando(false)
    setRespondidaPara(clienteId)
  }, [clienteId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return {
    saldo,
    documentos,
    isLoading: respondidaPara !== clienteId,
    isFetching: cargando,
    isError: hayError,
    refetch: cargar,
  }
}
