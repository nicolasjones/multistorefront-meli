import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerListaPorId, type ListaPrecios } from '../lib/listasPrecios'

// La lista de precios de un cliente para mostrarla en su ficha (solo lectura). Sin lista no consulta nada.
export function useListaPrecioDeCliente(listaId: string | null | undefined) {
  const [lista, setLista] = useState<ListaPrecios | null>(null)
  const [cargando, setCargando] = useState(Boolean(listaId))
  const [hayError, setHayError] = useState(false)
  const [intento, setIntento] = useState(0)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    if (!listaId) {
      setLista(null)
      setCargando(false)
      return
    }
    setCargando(true)
    leerListaPorId(supabaseClient, listaId)
      .then((resultado) => {
        if (peticion === ultimaPeticion.current) setLista(resultado)
      })
      .catch((error: unknown) => {
        console.error('No pudimos cargar la lista de precios del cliente.', error)
        if (peticion === ultimaPeticion.current) setHayError(true)
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [listaId, intento])

  return { lista, cargando, hayError, reintentar: () => setIntento((n) => n + 1) }
}
