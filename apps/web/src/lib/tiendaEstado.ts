import { useCallback, useEffect, useState } from 'react'
import { supabaseClient } from './supabase'

// F-TDA-19 (MSF-247): estado «pausada» de la tienda por dominio, para «Volvemos pronto» con la marca
// de la tienda (D1). Solo se consulta cuando `tienda_por_dominio` no devolvió tienda.

export type MarcaTiendaPausada = {
  nombre: string
  colorPrimario: string
  colorPrimarioOscuro: string
  colorAcento: string
  colorFondo: string
  tipografiaTitulos: string
  tipografiaTexto: string
  logoRuta: string | null
}

export type EstadoTienda =
  | { fase: 'cargando' }
  | { fase: 'pausada'; marca: MarcaTiendaPausada }
  | { fase: 'desconocida' }
  | { fase: 'error' }

type FilaPausada = {
  estado: 'pausada'
  nombre: string
  color_primario: string
  color_primario_oscuro: string
  color_acento: string
  color_fondo: string
  tipografia_titulos: string
  tipografia_texto: string
  logo_ruta: string | null
}

// publico.estado_tienda_por_dominio es ejecutable por anon. `null` = dominio desconocido, host inválido
// o empresa activa: la pantalla genérica. Un error de red se propaga (nunca se disfraza de «pausada»).
export async function resolverEstadoTienda(host: string): Promise<MarcaTiendaPausada | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('estado_tienda_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  const fila = data as FilaPausada | null
  if (!fila || fila.estado !== 'pausada') {
    return null
  }
  return {
    nombre: fila.nombre,
    colorPrimario: fila.color_primario,
    colorPrimarioOscuro: fila.color_primario_oscuro,
    colorAcento: fila.color_acento,
    colorFondo: fila.color_fondo,
    tipografiaTitulos: fila.tipografia_titulos,
    tipografiaTexto: fila.tipografia_texto,
    logoRuta: fila.logo_ruta,
  }
}

// Estado de un host sin tienda publicada. `reintentar` repite la consulta tras un error.
export function useEstadoTienda(host: string): { estado: EstadoTienda; reintentar: () => void } {
  const [estado, setEstado] = useState<EstadoTienda>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    setEstado({ fase: 'cargando' })
    resolverEstadoTienda(host)
      .then((marca) => { if (!cancelada) setEstado(marca ? { fase: 'pausada', marca } : { fase: 'desconocida' }) })
      .catch((error) => {
        console.error('No se pudo consultar el estado de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setEstado({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [host, intento])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])
  return { estado, reintentar }
}
