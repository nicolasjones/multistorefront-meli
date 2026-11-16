import { useEffect, useState } from 'react'
import { leerCapacidadOpiniones } from '../lib/tiendaOpiniones'

// ¿Se dibuja lo de opiniones en la tienda del host? (MSF-467, RF-OPI-10, RF-OPI-12). Mientras no responde y ante una falla es
// `false`: la interfaz no afirma una función que no verificó y, con la bandera apagada, la ficha y «Mi cuenta» quedan idénticas
// a las de antes. `activo = false` (vista previa del panel, que no lee `publico.*`) evita la llamada.
export function useCapacidadOpiniones(host: string, activo = true): boolean {
  const [resultado, setResultado] = useState<{ host: string; activa: boolean } | null>(null)
  useEffect(() => {
    if (!activo) return
    let cancelada = false
    leerCapacidadOpiniones(host)
      .then((activa) => { if (!cancelada) setResultado({ host, activa }) })
      .catch((error: unknown) => {
        console.error('No se pudo leer si la tienda muestra opiniones', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ host, activa: false })
      })
    return () => { cancelada = true }
  }, [host, activo])
  return activo && resultado?.host === host && resultado.activa
}
