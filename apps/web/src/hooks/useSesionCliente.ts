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
  // Cuenta los ingresos y salidas vistos (SIGNED_IN / SIGNED_OUT): distingue a una persona de otra aunque el estado
  // siga siendo `activa`, para que lo que depende de la persona (p. ej. sus favoritos) no sobreviva al cambio.
  version: number
  reintentar: () => void
}

// El encabezado, el menú y la ficha preguntan lo mismo en la misma página: una sola consulta por host mientras haya
// alguien mirando. El resultado (o la promesa en vuelo) se comparte entre los usos montados; cuando se desmonta el
// último se olvida. Un cambio de sesión (aviso de Auth) descarta lo compartido al instante y la primera consulta nueva
// la comparten los demás oyentes del mismo aviso.
type Entrada = { usos: number; promesa: Promise<Awaited<ReturnType<typeof sesionActivaEnTienda>>> | null }
const compartidas = new Map<string, Entrada>()

function consultar(host: string) {
  const entrada = compartidas.get(host)
  if (!entrada) return sesionActivaEnTienda(host)
  if (entrada.promesa) return entrada.promesa
  const promesa = sesionActivaEnTienda(host)
  entrada.promesa = promesa
  // Una falla no se conserva: el siguiente uso o «Reintentar» vuelve a preguntar.
  promesa.catch(() => { if (entrada.promesa === promesa) entrada.promesa = null })
  return promesa
}

// `activo = false` (vista previa del panel, que no lee `publico.*`) no hace ninguna llamada.
export function useSesionClienteDetallada(host: string, activo = true): SesionCliente {
  const [estado, setEstado] = useState<EstadoSesionCliente>('desconocida')
  const [falla, setFalla] = useState(false)
  const [version, setVersion] = useState(0)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    const entrada = compartidas.get(host) ?? { usos: 0, promesa: null }
    entrada.usos += 1
    compartidas.set(host, entrada)
    const evaluar = () => {
      consultar(host)
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
    // `intento > 0` es un «Reintentar»: pregunta de nuevo.
    if (intento > 0) entrada.promesa = null
    evaluar()
    // Diferido a otro turno: no se llama a Supabase desde dentro del callback de Auth (puede bloquear el cliente).
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') setVersion((actual) => actual + 1)
      entrada.promesa = null
      setTimeout(() => { if (!cancelada) evaluar() }, 0)
    })
    return () => {
      cancelada = true
      subscription.unsubscribe()
      entrada.usos -= 1
      if (entrada.usos <= 0 && compartidas.get(host) === entrada) compartidas.delete(host)
    }
  }, [host, activo, intento])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])
  return { estado: activo ? estado : 'desconocida', falla: activo && falla, version, reintentar }
}

export function useSesionCliente(host: string, activo = true): EstadoSesionCliente {
  return useSesionClienteDetallada(host, activo).estado
}
