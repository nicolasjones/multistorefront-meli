import { useCallback, useEffect, useState } from 'react'
import { leerCapacidadesTienda } from '../lib/tiendaCapacidades'

// Capacidades de la tienda del host (F-CLI-20, FR-014). Mientras no responde (`cargando`) y ante una falla (`error`) la
// interfaz no dibuja nada de la épica: no afirma una función que no verificó. `pedidos` solo es verdadero con la función
// encendida en el servidor.
export type EstadoCapacidadesTienda =
  | { fase: 'cargando'; pedidos: false; reintentar: () => void }
  | { fase: 'error'; pedidos: false; reintentar: () => void }
  | { fase: 'lista'; pedidos: boolean; reintentar: () => void }

type Resultado = { clave: string; fase: 'lista' | 'error'; pedidos: boolean }

// `activo = false` (vista previa del panel, que no lee `publico.*`) evita la llamada.
export function useCapacidadesTienda(host: string, activo = true): EstadoCapacidadesTienda {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, intento])

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    leerCapacidadesTienda(host)
      .then((capacidades) => {
        if (!cancelada) setResultado({ clave, fase: 'lista', pedidos: capacidades?.pedidos === true })
      })
      .catch((error) => {
        console.error('No se pudieron leer las capacidades de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, fase: 'error', pedidos: false })
      })
    return () => { cancelada = true }
    // `clave` resume host e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!activo || !resultado || resultado.clave !== clave) return { fase: 'cargando', pedidos: false, reintentar }
  return resultado.fase === 'lista' ? { fase: 'lista', pedidos: resultado.pedidos, reintentar } : { fase: 'error', pedidos: false, reintentar }
}
