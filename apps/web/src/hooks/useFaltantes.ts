import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  avisarFaltantes, listarFaltantes, type Faltante, type FiltrosFaltantes, type ResultadoAviso,
} from '../lib/faltantes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Lista de faltantes (F-STK-17, T032). Dos reglas (Principio VIII):
//  * «Última petición gana»: una respuesta vieja no pisa a la nueva.
//  * Cada resultado queda atado a su ÁMBITO (organización + empresa): si cambia, lo que había se descarta
//    de inmediato y nunca se muestran filas ni totales de la empresa anterior. Cambiar de página dentro
//    del mismo ámbito conserva las filas mientras llega lo nuevo.
//
// La SELECCIÓN también va atada al ámbito: línea elegida → cliente (el diálogo cuenta clientes). Al
// cambiar de empresa se descarta sola, así nunca se avisa a clientes de otra tienda.
type Lectura = { ambito: string; filas: Faltante[]; total: number } | { ambito: string; error: true }
type Seleccion = { ambito: string; items: Record<string, string> }

const SIN_FILAS: Faltante[] = []

export function useFaltantes(filtros: FiltrosFaltantes, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const { empresaId, pagina, tamano } = filtros
  const ambito = `${organizacionActiva?.id ?? ''}|${empresaId ?? 'todas'}`
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [cargando, setCargando] = useState(false)
  const [seleccion, setSeleccion] = useState<Seleccion>({ ambito: '', items: {} })
  const [ambitoSeleccion, setAmbitoSeleccion] = useState(ambito)
  const ultimaPeticion = useRef(0)

  // Al cambiar de ámbito la selección se DESCARTA y no vuelve a armarse sola (FR-311): si reapareciera
  // al volver a la empresa anterior, el botón «Avisar» se activaría con filas que la persona ya no
  // eligió. Se ajusta en el render (no en un efecto) para que no se dibuje ni un cuadro con la
  // selección de la empresa anterior.
  if (ambito !== ambitoSeleccion) {
    setAmbitoSeleccion(ambito)
    setSeleccion({ ambito, items: {} })
  }

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura
    try {
      resultado = { ambito, ...(await listarFaltantes({ empresaId, pagina, tamano })) }
    } catch (error) {
      console.error('No se pudo cargar la lista de faltantes', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
  }, [ambito, empresaId, pagina, tamano])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  const faltantes = vigente && 'filas' in lectura ? lectura.filas : SIN_FILAS
  const total = vigente && 'filas' in lectura ? lectura.total : 0

  // Solo valen las líneas elegidas en ESTE ámbito.
  const elegidos = useMemo(() => (seleccion.ambito === ambito ? seleccion.items : {}), [seleccion, ambito])

  const alternar = useCallback((fila: Faltante) => {
    setSeleccion((actual) => {
      const items = { ...(actual.ambito === ambito ? actual.items : {}) }
      if (items[fila.linea_id]) delete items[fila.linea_id]
      else items[fila.linea_id] = fila.cliente_id
      return { ambito, items }
    })
  }, [ambito])

  const alternarTodos = useCallback(() => {
    setSeleccion((actual) => {
      const items = { ...(actual.ambito === ambito ? actual.items : {}) }
      const todos = faltantes.length > 0 && faltantes.every((fila) => items[fila.linea_id])
      for (const fila of faltantes) {
        if (todos) delete items[fila.linea_id]
        else items[fila.linea_id] = fila.cliente_id
      }
      return { ambito, items }
    })
  }, [ambito, faltantes])

  // Avisa a los clientes de las líneas elegidas (un correo por cliente: lo decide la base), limpia la
  // selección y recarga para ver las líneas como «Avisado». Si la RPC falla, no limpia ni recarga.
  const avisar = useCallback(async (): Promise<ResultadoAviso> => {
    const resultado = await avisarFaltantes(Object.keys(elegidos))
    setSeleccion({ ambito, items: {} })
    await cargar()
    return resultado
  }, [ambito, cargar, elegidos])

  return {
    ambito,
    faltantes,
    total,
    isLoading: !habilitado || !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
    elegidos,
    alternar,
    alternarTodos,
    avisar,
  }
}
