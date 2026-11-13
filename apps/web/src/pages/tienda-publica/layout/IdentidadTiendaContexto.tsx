import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useFuenteTienda } from '../../../lib/fuenteTienda'
import { familiasACargar, resolverIdentidadPublica, urlFuentes, type IdentidadTienda } from '../../../lib/tiendaIdentidad'
import { ProveedorTemaTienda } from '../../../tema/ProveedorTemaTienda'

// MSF-841: la identidad de la tienda se lee UNA vez por host en el layout y llega a todas las rutas (portada,
// catálogo, categoría, ficha y contacto) por tres vías: el tema MUI (colores y tipografías de botones, enlaces y
// títulos), las variables CSS `--tienda-*` (portales de MUI y estilos sueltos) y este contexto (logo, color de
// barra, banners). Antes solo la sección de la portada la aplicaba y el resto de la tienda quedaba con el tema
// por defecto. Sin identidad legible la tienda sigue con el tema base: nunca se rompe por esto.

const ContextoIdentidad = createContext<IdentidadTienda | null>(null)

// La identidad de la tienda: la del layout o, en la vista previa del panel (F-TDA-06), la inyectada por la fuente.
export function useIdentidadTienda(): IdentidadTienda | null {
  const delLayout = useContext(ContextoIdentidad)
  const fuente = useFuenteTienda()
  return delLayout ?? fuente?.identidad ?? null
}

const VARIABLES = {
  '--tienda-color-primario': 'colorPrimario',
  '--tienda-color-primario-oscuro': 'colorPrimarioOscuro',
  '--tienda-color-acento': 'colorAcento',
  '--tienda-color-fondo': 'colorFondo',
  '--tienda-color-barra': 'colorBarra',
} as const satisfies Record<string, keyof IdentidadTienda>

const FUENTES_PRECONEXION = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']

export function aplicarVariables(identidad: IdentidadTienda): () => void {
  const raiz = document.documentElement
  const cuerpo = document.body
  for (const [variable, clave] of Object.entries(VARIABLES)) {
    raiz.style.setProperty(variable, String(identidad[clave as keyof IdentidadTienda]))
  }
  raiz.style.setProperty('--tienda-fuente-titulos', `"${identidad.tipografiaTitulos}", system-ui, sans-serif`)
  raiz.style.setProperty('--tienda-fuente-texto', `"${identidad.tipografiaTexto}", system-ui, sans-serif`)
  const fondoAnterior = cuerpo.style.backgroundColor
  cuerpo.style.backgroundColor = identidad.colorFondo
  // El texto fuera de la tipografía de MUI (enlaces del menú, etc.) hereda del body: sin esto salía en la serif del navegador.
  const fuenteAnterior = cuerpo.style.fontFamily
  cuerpo.style.fontFamily = 'var(--tienda-fuente-texto)'

  const url = urlFuentes(familiasACargar(identidad))
  const agregados: HTMLLinkElement[] = []
  if (url) {
    // Preconexión: la hoja y los archivos de fuente salen antes y el cambio de tipografía se nota menos.
    for (const origen of FUENTES_PRECONEXION) {
      const preconexion = document.createElement('link')
      preconexion.rel = 'preconnect'
      preconexion.href = origen
      if (origen.includes('gstatic')) preconexion.crossOrigin = ''
      preconexion.setAttribute('data-tienda-fuentes', '')
      document.head.appendChild(preconexion)
      agregados.push(preconexion)
    }
    const enlace = document.createElement('link')
    enlace.rel = 'stylesheet'
    enlace.href = url
    enlace.setAttribute('data-tienda-fuentes', '')
    document.head.appendChild(enlace)
    agregados.push(enlace)
  }
  return () => {
    for (const variable of [...Object.keys(VARIABLES), '--tienda-fuente-titulos', '--tienda-fuente-texto']) {
      raiz.style.removeProperty(variable)
    }
    cuerpo.style.backgroundColor = fondoAnterior
    cuerpo.style.fontFamily = fuenteAnterior
    agregados.forEach((enlace) => enlace.remove())
  }
}

// Lee la identidad del host, aplica variables y fuentes y envuelve la tienda en el tema MUI con esa identidad. No
// bloquea el pintado (la tienda arranca con el tema base y pasa a la identidad al llegar): el contenido no espera
// una petición más. En la vista previa (identidad inyectada) no se lee nada ni se tocan variables globales.
export function ProveedorIdentidadTienda({ host, children }: { host: string; children: ReactNode }) {
  const fuente = useFuenteTienda()
  const [leida, setLeida] = useState<{ host: string; identidad: IdentidadTienda | null } | null>(null)

  useEffect(() => {
    if (fuente) return
    let cancelada = false
    resolverIdentidadPublica(host)
      .then((identidad) => { if (!cancelada) setLeida({ host, identidad }) })
      .catch((error) => {
        console.error('No se pudo leer la identidad de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setLeida({ host, identidad: null })
      })
    return () => { cancelada = true }
  }, [host, fuente])

  const identidad = fuente ? fuente.identidad : leida?.host === host ? leida.identidad : null
  useEffect(() => (identidad && !fuente ? aplicarVariables(identidad) : undefined), [identidad, fuente])

  return (
    <ContextoIdentidad.Provider value={identidad}>
      <ProveedorTemaTienda identidad={identidad}>{children}</ProveedorTemaTienda>
    </ContextoIdentidad.Provider>
  )
}
