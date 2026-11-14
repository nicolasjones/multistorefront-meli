import { useCallback, useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { sesionActivaEnTienda } from '../lib/tiendaCuenta'

// Sesión del cliente en la tienda del host (F-CLI-06, FR-020): `activa` solo si la cuenta web está activa y
// habilitada en esta tienda. Se vuelve a evaluar cuando Auth avisa un cambio de sesión (ingreso, salida, refresco).
// `desconocida` = todavía no se sabe (carga inicial o error de red): la interfaz no debe afirmar ni «Ingresar» ni «Salir».
export type EstadoSesionCliente = 'desconocida' | 'activa' | 'sin_sesion'

export type SesionCliente = {
  estado: EstadoSesionCliente
  // La última verificación falló (red o base): `estado` sigue en `desconocida` y las pantallas que no pueden esperar
  // (p. ej. «Mi cuenta») ofrecen reintentar en vez de quedarse cargando.
  falla: boolean
  reintentar: () => void
}

// `activo = false` (vista previa del panel, que no lee `publico.*`) no hace ninguna llamada.
export function useSesionClienteDetallada(host: string, activo = true): SesionCliente {
  const [estado, setEstado] = useState<EstadoSesionCliente>('desconocida')
  const [falla, setFalla] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    const evaluar = () => {
      sesionActivaEnTienda(host)
        .then((acceso) => {
          if (cancelada) return
          setEstado(acceso ? 'activa' : 'sin_sesion')
          setFalla(false)
        })
        .catch((error) => {
          console.error('No se pudo verificar la sesión del cliente', error instanceof Error ? error.message : error)
          if (cancelada) return
          setEstado('desconocida')
          setFalla(true)
        })
    }
    evaluar()
    // Diferido a otro turno: no se llama a Supabase desde dentro del callback de Auth (puede bloquear el cliente).
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(() => { setTimeout(evaluar, 0) })
    return () => {
      cancelada = true
      subscription.unsubscribe()
    }
  }, [host, activo, intento])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])
  return { estado: activo ? estado : 'desconocida', falla: activo && falla, reintentar }
}

export function useSesionCliente(host: string, activo = true): EstadoSesionCliente {
  return useSesionClienteDetallada(host, activo).estado
}
