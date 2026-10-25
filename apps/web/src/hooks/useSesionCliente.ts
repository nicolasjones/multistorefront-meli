import { useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { sesionActivaEnTienda } from '../lib/tiendaCuenta'

// Sesión del cliente en la tienda del host (F-CLI-06, FR-020): `activa` solo si la cuenta web está activa y
// habilitada en esta tienda. Se vuelve a evaluar cuando Auth avisa un cambio de sesión (ingreso, salida, refresco).
// `desconocida` = todavía no se sabe (carga inicial o error de red): la interfaz no debe afirmar ni «Ingresar» ni «Salir».
export type EstadoSesionCliente = 'desconocida' | 'activa' | 'sin_sesion'

export function useSesionCliente(host: string): EstadoSesionCliente {
  const [estado, setEstado] = useState<EstadoSesionCliente>('desconocida')

  useEffect(() => {
    let cancelada = false
    const evaluar = () => {
      sesionActivaEnTienda(host)
        .then((acceso) => { if (!cancelada) setEstado(acceso ? 'activa' : 'sin_sesion') })
        .catch((error) => {
          console.error('No se pudo verificar la sesión del cliente', error instanceof Error ? error.message : error)
          if (!cancelada) setEstado('desconocida')
        })
    }
    evaluar()
    // Diferido a otro turno: no se llama a Supabase desde dentro del callback de Auth (puede bloquear el cliente).
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(() => { setTimeout(evaluar, 0) })
    return () => {
      cancelada = true
      subscription.unsubscribe()
    }
  }, [host])

  return estado
}
