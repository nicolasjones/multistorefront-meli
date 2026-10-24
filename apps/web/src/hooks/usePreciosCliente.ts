import { useEffect, useState } from 'react'
import { leerPreciosCliente, type PreciosCliente } from '../lib/tiendaPreciosCliente'

type Resultado = { clave: string; precios: PreciosCliente | null }

// Precios del cliente para la ficha (F-CLI-07, FR-035). Una llamada por carga (host + producto), sin
// caché entre cargas; si cambia el producto no se muestran los precios del anterior.
export function usePreciosCliente(host: string, productoId: string): PreciosCliente | null {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, productoId])

  useEffect(() => {
    const claveCarga = JSON.stringify([host, productoId])
    let cancelada = false
    leerPreciosCliente(host, productoId)
      .then((precios) => { if (!cancelada) setResultado({ clave: claveCarga, precios }) })
      .catch((error) => {
        console.error('No se pudieron cargar los precios del cliente', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave: claveCarga, precios: null })
      })
    return () => { cancelada = true }
  }, [host, productoId])

  return resultado?.clave === clave ? resultado.precios : null
}
