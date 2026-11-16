import { useCallback, useEffect, useRef, useState } from 'react'
import { listarItemsConsulta, type ItemConsulta } from '../lib/consultas'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Ítems del pedido de una consulta abierta (MSF-176, B1, P-6). `consultaId = null` (la consulta no es un pedido) no llama. Cada resultado queda atado a la consulta y a la
// organización activa: si cambian (otra empresa activa cierra el diálogo y la lista se recarga) no se muestra lo de la anterior. Última petición gana.
export type ItemsConsulta =
  | { fase: 'cargando'; items: readonly ItemConsulta[]; reintentar: () => void }
  | { fase: 'error'; items: readonly ItemConsulta[]; reintentar: () => void }
  | { fase: 'lista'; items: readonly ItemConsulta[]; reintentar: () => void }

type Lectura = { clave: string; items: ItemConsulta[] } | { clave: string; error: true }

export function useItemsConsulta(consultaId: string | null): ItemsConsulta {
  const { organizacionActiva } = useOrganizacionActiva()
  const clave = `${organizacionActiva?.id ?? ''}|${consultaId ?? ''}`
  const [intento, setIntento] = useState(0)
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    if (!consultaId) return
    const peticion = ++ultimaPeticion.current
    listarItemsConsulta(consultaId).then(
      (items) => { if (peticion === ultimaPeticion.current) setLectura({ clave, items }) },
      (error: unknown) => {
        console.error('No se pudieron cargar los productos del pedido', error instanceof Error ? error.message : error)
        if (peticion === ultimaPeticion.current) setLectura({ clave, error: true })
      },
    )
  }, [consultaId, clave, intento])

  const reintentar = useCallback(() => {
    setLectura(null)
    setIntento((n) => n + 1)
  }, [])

  const vigente = consultaId !== null && lectura !== null && lectura.clave === clave
  if (!vigente) return { fase: 'cargando', items: [], reintentar }
  return 'error' in lectura ? { fase: 'error', items: [], reintentar } : { fase: 'lista', items: lectura.items, reintentar }
}
