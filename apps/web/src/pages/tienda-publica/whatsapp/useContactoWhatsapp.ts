import { useEffect, useState } from 'react'
import { supabaseClient } from '../../../lib/supabase'
import { normalizarNumero } from '../../../lib/whatsapp'

// F-TDA-14 (MSF-433): contacto de la tienda para el botón «Consultar por WhatsApp» (FR-020, FR-021).
// Lee `publico.contacto_por_dominio` con el cliente Supabase compartido. No edita `lib/tiendaContacto.ts`
// (es de F-TDA-16): esta historia llama directo a la función pública.

export type ContactoWhatsapp = {
  // Nombre de la empresa tal como lo muestra la empresa.
  nombre: string
  // Número como lo tiene la empresa (se muestra tal cual).
  numero: string
  // Solo dígitos, para el enlace `wa.me`. Viene de `normalizarNumero`: sin número válido no hay botón.
  digitos: string
}

export type EstadoContactoWhatsapp =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'sin-contacto' }
  | { fase: 'sin-numero' }
  | { fase: 'listo'; contacto: ContactoWhatsapp }

type FilaContacto = { nombre?: string; whatsapp?: string | null }

// `publico.contacto_por_dominio` es ejecutable por `anon`. `null` cubre host desconocido y empresa
// desactivada: el front no distingue los casos.
export async function leerContactoWhatsapp(host: string): Promise<FilaContacto | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('contacto_por_dominio', { host })
  if (error) throw new Error(error.message)
  if (!data) return null
  return data as FilaContacto
}

// Contacto de la tienda para WhatsApp. Si cambia el host nunca se muestra el contacto anterior: se vuelve
// a «cargando» hasta que llega el nuevo. Un error de lectura se anota en la consola y deja la pantalla
// sin botón (sin hueco): el visitante no ve detalles técnicos de la plataforma.
export function useContactoWhatsapp(host: string): EstadoContactoWhatsapp {
  const [resultado, setResultado] = useState<{ clave: string; estado: EstadoContactoWhatsapp } | null>(null)
  const clave = host

  useEffect(() => {
    let cancelada = false
    leerContactoWhatsapp(host)
      .then((fila) => {
        if (cancelada) return
        if (!fila) {
          setResultado({ clave, estado: { fase: 'sin-contacto' } })
          return
        }
        const digitos = normalizarNumero(fila.whatsapp)
        if (!digitos) {
          setResultado({ clave, estado: { fase: 'sin-numero' } })
          return
        }
        setResultado({
          clave,
          estado: {
            fase: 'listo',
            contacto: { nombre: fila.nombre ?? '', numero: fila.whatsapp ?? '', digitos },
          },
        })
      })
      .catch((error) => {
        console.error('No se pudo leer el contacto de WhatsApp de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ clave, estado: { fase: 'error' } })
      })
    return () => { cancelada = true }
    // `clave` es el host: si cambia la tienda, se vuelve a leer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!resultado || resultado.clave !== clave) return { fase: 'cargando' }
  return resultado.estado
}
