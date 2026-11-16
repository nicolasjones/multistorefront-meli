import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { leerContactoTienda, type ContactoTienda } from '../lib/tiendaContacto'

export type EstadoContactoTienda =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'no-encontrada' }
  | { fase: 'lista'; contacto: ContactoTienda }

export type ContactoPublico = EstadoContactoTienda & { reintentar: () => void }

type Resultado = { clave: string; estado: Exclude<EstadoContactoTienda, { fase: 'cargando' }> }

// MSF-841: el layout de la tienda lee el contacto UNA vez por host y lo comparte (barra superior, pie, bloque de la
// portada y `/contacto`) por este contexto; sin proveedor (vista previa, tests) cada uso lee por su cuenta.
export const ContextoContactoTienda = createContext<ContactoPublico | null>(null)

// Lectura del layout: una sola petición por host para toda la tienda.
export function useLeerContactoTienda(host: string, activo = true): ContactoPublico {
  const [intento, setIntento] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const clave = JSON.stringify([host, intento])

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    leerContactoTienda(host)
      .then((contacto) => {
        if (cancelada) return
        setResultado({ clave, estado: contacto ? { fase: 'lista', contacto } : { fase: 'no-encontrada' } })
      })
      .catch((error) => {
        console.error('No se pudieron cargar los datos de contacto', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` resume host e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!resultado || resultado.clave !== clave) return { fase: 'cargando', reintentar }
  return { ...resultado.estado, reintentar }
}

// Datos de contacto de la tienda (F-TDA-16, FR-009). Si cambia el host nunca se muestra el contacto anterior:
// se vuelve a «cargando» hasta que llega el nuevo. Usa el del layout si lo hay.
// `leer = false` (vista previa del panel, que no lee `publico.*`) evita la lectura propia.
export function useContactoTienda(host: string, leer = true): ContactoPublico {
  const compartido = useContext(ContextoContactoTienda)
  const propio = useLeerContactoTienda(host, compartido === null && leer)
  return compartido ?? propio
}
